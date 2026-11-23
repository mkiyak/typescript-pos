# Asseco / Payten 3D Pay Hosting

Gateway `AssecoPos` covers İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank and QNB
Finansbank (Asseco). Complete compile-checked code: [`examples/asseco-3d-secure.ts`](../examples/asseco-3d-secure.ts).

Status: unit-tested, the hash is differential-tested against PHP; not yet run against a live
bank environment. Do your own end-to-end test with your bank's test merchant before going live.

## Models

| Model                        | Card entered         | Notes                                                              |
| ---------------------------- | -------------------- | ------------------------------------------------------------------ |
| `MODEL.THREE_D_PAY_HOSTING`  | on the bank page     | Recommended: card data never reaches your server (PCI scope stays small). |
| `MODEL.THREE_D_HOST`         | on the bank page     | Uses `gateway_3d_host` when configured.                            |
| `MODEL.THREE_D_PAY`          | on your page         | You pass a `CreditCard`; card data passes through your server.     |
| `MODEL.THREE_D_SECURE`       | on your page         | 3D authentication, then a provision request from your server.      |
| `MODEL.NON_SECURE`           | on your page         | No 3D Secure.                                                      |

## Configuration

```ts
import { AccountFactory, PosFactory, posProductionConfig } from 'typescript-pos'

const account = AccountFactory.createAssecoPosAccount('isbank', clientId, username, password, storeKey)
const pos = PosFactory.createPosGateway(account, posProductionConfig, { timeoutMs: 30_000 })
```

- The first argument of the account factory is the key of `banks` in the config (`isbank`, `akbank`, `halkbank`,
  `teb`, `sekerbank`, `finansbank`, `ziraat-asseco`).
- `storeKey` is the 3D secret key you configure in the bank's merchant panel.
- Test environment: `posTestConfig` only has the vendor entry `asseco` (plus `vakifbank` and `ziraat-vpos`).
  Use the bank name `asseco` for the test account, or keep your production name with
  `{ banks: { isbank: posTestConfig.banks.asseco! } }`.
- Options of `createPosGateway`: `logger` (receives only masked data), `hooks`, `fetch`, `transport`, `timeoutMs`,
  `testMode`.

## Flow

1. Create the order and **persist `id` and `amount` on your server**. The callback is checked against them.
2. `pos.get3DFormData(order, MODEL.THREE_D_PAY_HOSTING, TX_TYPE.PAY_AUTH)` returns `{ gateway, method: 'POST', inputs }`.
   Render an auto-submitting HTML form to the customer. `success_url` and `fail_url` are required (they may be the
   same URL), as are `id`, `amount`, `currency` and `ip`.
3. The bank POSTs the customer to your callback URL. Load the order **by id on the server** and call
   `pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)`.
4. Check `response.status` (`approved` / `declined`). Also look at `requires_manual_review`.

## Callback handling

- **Cross-site POST.** The bank posts from another site, so `SameSite=Lax` session cookies are usually not sent. Do
  not rely on the session to find the order: use the order id from the callback (`oid`) to load it from your database.
  Set the route to accept `application/x-www-form-urlencoded` and exempt it from CSRF middleware (the hash is the
  authentication).
- **Always go through the gateway.** `payment()` / `make3DPayPayment()` verify the hash first
  (`HashMismatchError` otherwise, also for a missing or non-string `HASH`), map the response and then compare the
  returned order id and amount with your order. Never read `ProcReturnCode`, `mdStatus` or `Response` straight from
  the callback body.
- **`OrderMismatchError` is a failure, always.** It can occur on any 3D Pay / 3D Host callback, even a declined one.
  `error.field` is `order_id` or `amount`. `error.response` carries the mapped response (`transaction_id`,
  `proc_return_code`, `requires_manual_review`; `all` is masked). When `error.response.requires_manual_review` is
  `true` the bank may have authorized the payment: investigate and void/refund it.
- **`requires_manual_review`.** The bank authorized (`ProcReturnCode=00`) but 3D verification (`mdStatus`) failed. The
  response is `declined`, yet money may have moved. Alert someone and reconcile with the bank panel or `pos.status()`.

```ts
try {
  const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)
  if (response.requires_manual_review) alertOps(response.order_id, response.transaction_id)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError) return false // forged or corrupted
  if (error instanceof OrderMismatchError) {
    if (error.response?.requires_manual_review) alertOps(error.expected, error.response.transaction_id)
    return false
  }
  throw error // PosHttpError etc.: retry or inspect
}
```

## Money operations

`pos.cancel({ id })`, `pos.refund({ id, amount, currency })` (partial when `order_amount` is set and `amount` is
lower), `pos.status({ id })`, `pos.orderHistory({ id })`. Pre-/post-authorization: `TX_TYPE.PAY_PRE_AUTH`, then
`TX_TYPE.PAY_POST_AUTH` through `pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)`.

## Good to know

- Amounts are major units (`10.5`). Currency codes: `TRY`, `USD`, `EUR`, `GBP`, `JPY`, `RUB`.
- Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00).
- Non-ASCII order data (e.g. `İşbank Ödeme`) is hashed as UTF-8 and verified correctly.
- Request bodies are sent as ISO-8859-9, as the NestPay API expects.
