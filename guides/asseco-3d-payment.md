# Asseco / Payten 3D Pay Hosting

Gateway `AssecoPos` covers İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank and QNB
Finansbank (Asseco). Complete compile-checked code: [`examples/asseco-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/asseco-3d-secure.ts).

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
  `{ banks: { isbank: posTestConfig.banks.asseco } }`.
- Options of `createPosGateway`: `logger` (receives only masked data), `hooks`, `fetch`, `transport`, `timeoutMs`,
  `testMode`.

## Flow

1. Create the order and **persist `id` and `amount` on your server**. The callback is checked against them.
2. `pos.get3DFormData(order, MODEL.THREE_D_PAY_HOSTING, TX_TYPE.PAY_AUTH)` returns `{ gateway, method: 'POST', inputs }`.
   Render an auto-submitting HTML form to the customer. `success_url` and `fail_url` are required (they may be the
   same URL), as are `id`, `amount`, `currency` and `ip`.
3. The bank POSTs the customer to your callback URL. Load the order **by id on the server** and call
   `pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)`.
4. Check `response.status` (`approved` / `declined`). Also look at `requires_manual_review`. The callback must be
   completed with the model it was started with: the signed `storetype` (`3d_pay_hosting`, `3d_pay`, `3d_host`,
   `3d`) is checked against the method (`OrderMismatchError` with `field: 'storetype'` otherwise).

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
  `error.field` is `order_id`, `amount` or `storetype` (a callback produced for another payment model, e.g. a
  3D Pay Hosting callback completed with `MODEL.THREE_D_HOST`). `error.response` carries the mapped response
  (`transaction_id`, `proc_return_code`, `requires_manual_review`; `all` is masked).
- **`error.paymentMayHaveCompleted`.** `true` when the bank reported the callback as a completed payment
  (`status: 'approved'` or `ProcReturnCode=00`), for example a genuine, correctly signed approval for another amount.
  The card may have been charged although your order is not paid: alert someone and void or refund it using
  `error.response.transaction_id`. `error.response.requires_manual_review` is `true` in that case too. Do not only
  check `requires_manual_review` on the mapped response: branch on `paymentMayHaveCompleted`.
- **`requires_manual_review`.** The bank authorized (`ProcReturnCode=00`) but 3D verification (`mdStatus`) failed. The
  response is `declined`, yet money may have moved. Alert someone and reconcile with the bank panel or `pos.status()`.
- **Outcome unknown.** A `PosHttpError` (timeout, non-2xx, HTML/WAF page) after a request that moves money
  (`MODEL.THREE_D_SECURE` provisioning, non-3D payments, post-authorization, cancel, refund) does not mean the
  bank did nothing: the request may have been processed before the connection failed. Never retry a payment blindly,
  since that can charge the customer twice. Call `pos.status(order)` first and retry only when the bank has no record
  of the transaction.

```ts
try {
  const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)
  if (response.requires_manual_review) alertOps(response.order_id, response.transaction_id)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError) return false // forged or corrupted
  if (error instanceof OrderMismatchError) {
    // the bank may have charged the card for this callback: alert, then void or refund
    if (error.paymentMayHaveCompleted) alertOps(error.expected, error.response?.transaction_id)
    return false
  }
  // PosHttpError etc.: outcome unknown. Never retry blindly; check pos.status(order) first.
  throw error
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
