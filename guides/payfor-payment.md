# PayFor payments (QNB Finansbank, Ziraat Katılım)

Gateway `PayForPos`, bank keys `qnbfinansbank-payfor` and `ziraat-katilim-payfor`. Complete compile-checked code:
[`examples/payfor-3d-pay.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/payfor-3d-pay.ts).

Status: unit-tested; the form hash, the callback hash and the amount format are differential-tested against PHP
built-ins (2,000 random sets each, 0 mismatches).

## Banks and account

| Bank | Config key | Institution code |
| --- | --- | --- |
| QNB Finansbank (default) | `qnbfinansbank-payfor` | `5` (`PayForPosAccount.MBR_ID_FINANSBANK`) |
| Ziraat Katılım | `ziraat-katilim-payfor` | `12` (`PayForPosAccount.MBR_ID_ZIRAAT_KATILIM`) |

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor', // key of `banks` in the config
  merchantId,
  userCode,
  userPassword,
  merchantPass, // the merchant (3D) password: needed for every 3D model
  // '12', // sixth argument, only for Ziraat Katılım (PayForPosAccount.MBR_ID_ZIRAAT_KATILIM)
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created, so nothing is ever signed or
sent with a missing value. `success_url` and `fail_url` are required for the 3D form; banks and their firewalls
usually need public HTTPS URLs without `localhost`.

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Host | `MODEL.THREE_D_HOST` | Recommended. The bank page collects the card, so nothing card-related touches your server. |
| 3D Pay | `MODEL.THREE_D_PAY` | The card goes into hidden form inputs your page renders; the bank charges during the 3D step and the callback carries the result. |
| 3D Secure | `MODEL.THREE_D_SECURE` | Same form, but after the callback you call `payment`, which sends the provision request. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Never store the card for 3D Pay or 3D Secure: nothing after the form needs it, so pass `null` as the card to
`payment`. Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) is available for all four models and `TX_TYPE.PAY_POST_AUTH`
captures it. Other operations: `status`, `cancel`, `refund` (full or partial) and `orderHistory`. A refund must fall
into a different batch than the sale, so cancel a sale of the same day instead of refunding it.

## Flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) on your server and tie it to the customer's session
   before redirecting.
2. `pos.get3DFormData(order, model, TX_TYPE.PAY_AUTH, card)` returns `{ gateway, method: 'POST', inputs }`. Render a
   form that posts `inputs` to `gateway` and submit it automatically. For 3D Host pass `null` as the card and `true`
   as the fifth argument (`createWithoutCard`).
3. The customer authenticates; the bank POSTs the browser to your `success_url` or `fail_url`.
4. Load the order from the customer's session on the server and call
   `pos.payment(model, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. For 3D Secure the library then sends the
   provision request.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

`formFormat: 'html'` (3D Secure and 3D Pay only) posts the form, card data included, from your server and returns
the bank's own HTML page. That is the bank's markup: serve it as the bank's page (for example as the whole response
of a dedicated route), not inserted into your own pages. Prefer the default array form, which the browser posts
itself.

## Callback handling

- **The signature is always verified.** A callback that carries the bank's `ResponseHash` is verified whatever it
  reports; a wrong hash throws `HashMismatchError`. The check cannot be switched off. The hash covers fixed fields
  that are joined without separators, so after it verifies the signed fields must also have the bank's formats,
  otherwise `HashMismatchError` as well. Careful: for 3D Pay and 3D Host that error can come from a genuine
  approved callback in an unexpected format, so the card may have been charged; re-check with `orderHistory` before
  you tell the customer the payment failed. A callback value that is not a plain string (an object or an array) is
  rejected with `PosError` before anything else.
- **Unsigned callbacks.** QNB Finansbank signs every callback, so an unsigned successful one is rejected. A Ziraat
  Katılım callback without a signature is never enough on its own: for 3D Pay and 3D Host the result is returned only
  after the status confirmation below finds the bank's matching approved record, and for 3D Secure an unsigned
  callback is refused with `HashMismatchError` and no provision request is sent. An unsigned callback never sets
  `requires_manual_review` or `paymentMayHaveCompleted` by itself: they are set only when a status request shows that
  the bank holds an approved payment of the order. `require_3d_hash: true` in the bank's config also rejects unsigned
  decline callbacks.
- **The callback is bound to the order.** The order id, amount, currency, transaction type, installment count and
  model echoed in the callback must match the order, and the merchant and institution codes your account; a mismatch
  throws `OrderMismatchError` (`field` names the value). Load the order from the customer's session, never from a
  field of the callback.
- **Approved results are confirmed with the bank.** The bank does not sign the amount or the currency, so every
  approved 3D result is confirmed with one status request before it is returned: the bank must report this order as
  approved with the same transaction type, amount, currency and installment count (for a single payment, none, `0`
  and `1` are equal), not cancelled or refunded (a cancellation or refund field the library cannot read as "none"
  counts as cancelled). Expect one extra request per approved payment. The authorization code, transaction time,
  host reference (`ref_ret_num`) and masked card number of the result are taken from that record; the last two are
  `null` when the record has none. When the bank does not confirm it, the call
  throws `OrderMismatchError` with `paymentMayHaveCompleted: true` and `error.response` set: alert someone, then
  cancel or refund the payment. A network error (`PosHttpError`, timeout) during the confirmation propagates as is
  and means the payment may have completed: keep the order pending and re-check it later with `pos.status(order)`.
- **Approved but 3D failed.** When the bank authorized money although the 3D authentication did not succeed, the
  response is `declined` with `requires_manual_review: true`. Do not ship the goods; reconcile in the bank panel.
- **Complete each order once.** Mark it paid in an idempotent update: a replayed callback maps to the same result
  and must not ship the goods a second time.

Use order ids of one fixed length (zero-padded numbers or UUID-based ids): one id must never be another id plus
extra characters, because the signed callback values are concatenated.

## Order ids and amounts

- An order id is 1 to 64 letters, digits, `_` or `-`; anything else throws `PosError` before a request is sent.
- Amounts are sent with up to two decimals, rounded like PHP `number_format`.
- Bank times without a UTC offset are Türkiye time (UTC+03:00).

## Queries

`PayForPosQuery` (see [queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)) offers:

- `customQuery(requestData, apiUrl?)`: a request in the bank's own format; `MerchantId`, `UserCode`, `UserPass` and
  `MbrId` are added from the account when you leave them out.
- `history({ transaction_date })`: the transactions of that day (a `Date`). Its `status` is `null` when the bank's
  answer carries no overall result.
- `pos.orderHistory({ id })` (on the gateway, not the query): the transactions of one order.
