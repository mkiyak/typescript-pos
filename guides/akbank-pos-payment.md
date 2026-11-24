# Akbank virtual POS payments (3D Secure, 3D Pay, 3D Host, non-secure)

Gateway `AkbankPos`, bank key `akbank-pos` (the bank's JSON API with signed requests; the Asseco-based `akbank` entry is
a different gateway). Complete compile-checked code:
[`examples/akbank-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/akbank-3d-host.ts).

Status: unit-tested; the request signature, the 3D form hash, the callback signing string and the amount format are
differential-tested against PHP built-ins (1000 random inputs each, 0 mismatches).

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | The card is posted to the bank's 3D page from your page. After the callback you call `payment`, which sends the provision request. |
| 3D Pay | `MODEL.THREE_D_PAY` | The bank charges during the 3D step; the callback already carries the result. |
| 3D Host | `MODEL.THREE_D_HOST` | The card page is at the bank, so no card data reaches your server. The callback carries the result. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) is available for all four models and `TX_TYPE.PAY_POST_AUTH` captures it.
A recurring payment is a non-secure payment whose order carries
`recurring: { frequency, frequencyType, installment }`. The bank offers no status request: `pos.status()` rejects with
`UnsupportedTransactionTypeError`; use `orderHistory`. Except for 3D Host, the card number reaches your server, so
PCI DSS scope applies.

## Configuration and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createAkbankPosAccount(
  'akbank-pos', // key of `banks` in the config
  merchantSafeId,
  terminalSafeId,
  secretKey, // signs every request and every 3D form
  subMerchantId, // optional, only for sub-merchant accounts
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

- All three credentials are required; an empty or blank value throws `MissingAccountInfoError` when the account is
  created, so nothing is ever signed or sent with a missing value. A blank sub-merchant id means no sub-merchant.
- Every request carries an `auth-hash` header, the HMAC of the exact request body with the secret key. Requests also
  carry the current Türkiye time and the bank rejects them when it is off, so keep the server clock correct (NTP).
- `success_url` and `fail_url` are required for the 3D form. Banks and their
  firewalls usually need public HTTPS URLs without `localhost`.

## Flow

1. Persist the order (`id`, `amount`, `currency`) on your server and tie it to the customer's session before
   redirecting.
2. `pos.get3DFormData(order, model, TX_TYPE.PAY_AUTH, card)` returns `{ gateway, method: 'POST', inputs }`. Render a
   form that posts `inputs` to `gateway` and submit it automatically. For 3D Host pass `null` as the card and `true`
   as the fifth argument (`createWithoutCard`).
3. The customer authenticates; the bank POSTs the browser to your `success_url` or `fail_url`.
4. Load the order from the customer's session on the server and call
   `pos.payment(model, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. Pass `null` as the card: it is not needed
   after the redirect, so do not keep it (store it neither in your session nor in your database) once `get3DFormData`
   has built the form. For 3D Secure the library then sends the provision request.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

Use order ids of one fixed length or format (zero-padded numbers or UUID-based ids). The callback is a signed
concatenation of its values, so ids with a single shape keep it unambiguous where the order id ends.

## Callback handling

- **The signature cannot be switched off.** The callback carries a `hash` over the fields named in `hashParams`. 3D Pay
  and 3D Host callbacks must always be signed, a decline included. A 3D Secure callback without 3D success (response
  code other than `VPS-0000`) moves no money and maps as declined; a 3D-successful one must be signed. A signed
  callback whose decisive fields are malformed throws `HashMismatchError`, and so does a wrong hash. Comparisons are
  constant time. A callback value that is not a plain string (an object or an array) is rejected with `PosError`
  before anything else.
- **The callback is bound to the order.** A mismatch throws `OrderMismatchError` (`field` names the value).
  - 3D Pay and 3D Host: the order id of every callback, a decline included, must equal `order.id`; the merchant and
    terminal safe ids must equal your account's for an approved callback.
  - 3D Secure: for a 3D-successful callback the order id, merchant and terminal safe ids are checked before the
    provision request, which always uses your own order id, amount, currency and installment, never values from the
    callback. A 3D Secure callback without 3D success is mapped as declined without these checks.
  - In every model, load the order from the customer's session, never from a field of the callback.
- **3D Pay and 3D Host approvals are confirmed with the bank.** The callback carries no amount, so before `approved` is
  returned the library sends one signed order-history request and requires an approved, completed transaction of the
  requested type for your order amount and currency. If the bank does not confirm it, the call throws
  `OrderMismatchError` with `paymentMayHaveCompleted: true` and `error.response` set: check the bank panel, then
  void or refund the payment. A network error (`PosHttpError`, timeout) during the confirmation propagates as is and
  means the payment may have completed: keep the order pending and re-check it later with `pos.orderHistory(order)`.
- **Approved but 3D failed.** When the bank authorized money although the 3D result is not successful, the response is
  `declined` with `requires_manual_review: true`. Do not ship the goods; reconcile in the bank panel.
- **Complete each order once.** Mark it paid in an idempotent update: a replayed callback maps to the same result
  and must not ship the goods a second time.

## Money operations

```ts
await pos.cancel({ id: orderId })
await pos.refund({ id: orderId, amount: 25, currency: 'TRY', order_amount: 100 }) // partial: amount < order_amount
await pos.orderHistory({ id: orderId })
await pos.payment(MODEL.NON_SECURE, { id: orderId, amount: 100, currency: 'TRY', ip }, TX_TYPE.PAY_POST_AUTH, null)

// recurring payments
await pos.cancel({ recurring_id, recurringOrderInstallmentNumber: 2, recurring_payment_is_pending: true })
await pos.orderHistory({ recurring_id })
```

`cancel` without the recurring fields voids the order; with `recurringOrderInstallmentNumber` it cancels that
installment, and without `recurring_payment_is_pending` the whole recurring instruction. A refund of a recurring
installment needs `recurring_id` and `recurringOrderInstallmentNumber` as well.

## Queries

`AkbankPosQuery` (see [queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)) offers:

- `history({ batch_num })` or `history({ start_date, end_date })`: transactions of a batch or a date range. The two
  dates are `Date` objects at most one day apart and are written in Türkiye time.
- `customQuery(requestData, apiUrl?)`: a request in the bank's own format, with the terminal data, version, request
  time and random number added and the request signed.

## Good to know

- Amounts are sent with two decimals, rounded like PHP `number_format`.
- Bank times without a UTC offset are Türkiye time (UTC+03:00).
- `post-auth`, 3D Secure provisioning and non-secure payments need the customer `ip` in the order; a missing one is
  rejected with `PosError` before any request.
