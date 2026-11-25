# InterPos payments (Denizbank InterVPOS)

Gateway `InterPos`, bank key `denizbank`. Complete compile-checked code:
[`examples/interpos-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/interpos-3d-host.ts).

Status: unit-tested; the form hash, the callback hash and the amount format are differential-tested against PHP
built-ins (2,000 random sets each, 0 mismatches).

## Bank and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createInterPosAccount(
  'denizbank', // key of `banks` in the config
  shopCode,
  userCode,
  userPassword,
  merchantPass, // the merchant (3D) password: needed for every 3D model, not for non-secure requests
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
captures it. Other operations: `status`, `cancel` and `refund` (full or partial). The bank API offers no order
history. Only the default array form is supported: `formFormat: 'html'` is refused.

Refund requests carry no currency field, so use refunds for sales in TRY.

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

## Callback handling

- **The signature is always verified.** A callback that carries the bank's `HASH` is verified for every model and
  every outcome, over the one fixed list of fields the bank signs; a wrong hash, or any other announced list, throws
  `HashMismatchError`. The check cannot be switched off. The signed values are joined without separators, so for
  every callback that reports 3D success or an approval their formats must also match the bank's, otherwise
  `HashMismatchError` as well. A signed decline is mapped as it came, because the bank's decline texts are free form.
  A callback value that is not a plain string (an object or an array) is rejected with `PosError` before anything
  else.
- **Unsigned callbacks.** A callback without `HASH` can only ever become a decline: one that reports success is
  rejected with `HashMismatchError`, and `require_3d_hash: true` in the bank's config rejects unsigned declines too.
  An unsigned decline carries none of the callback's values (the order id is your order's; amount, currency, card
  mask and authorization data are `null`); only a bounded set of decline reasons, `all` and (3D Secure) `3d_all` are
  kept, and those are informational and untrusted. It never sets `requires_manual_review`.
- **The callback is bound to the order.** On every callback that reports 3D success or an approval, the signed order
  id, amount and currency must equal the order's, and the shop code, when present, your account's; a mismatch throws `OrderMismatchError` (`field` names the value). This
  runs before the payment model is checked, and before any provision request. Load the order from the customer's
  session, never from a field of the callback. A signed decline is returned as the bank sent it, without this check:
  never use its `order_id` to look up an order.
- **Approved 3D Pay and 3D Host results are confirmed with the bank.** Every approved result is confirmed with one
  status request before it is returned: the bank's record must be approved for this order and amount, with an
  authorization code, and neither voided nor refunded. Expect one extra request per approved payment. The
  authorization code and transaction id of the result come from that record. When the bank does not confirm it, the
  call throws `OrderMismatchError` with `paymentMayHaveCompleted: true` and `error.response` set: alert someone, then
  cancel or refund the payment. A network error (`PosHttpError`, timeout) during the confirmation propagates as is
  and also means the payment may have completed: keep the order pending and re-check it later with `pos.status(order)`.
- **3D Secure.** The provision request is sent only for a 3D-successful callback that belongs to the order, and its
  answer must be approved for this order and amount, otherwise `OrderMismatchError` with the result attached. A
  3D Pay result posted to a 3D Secure order is `OrderMismatchError` on `payment_model` and nothing is provisioned; it
  costs one status request, and `paymentMayHaveCompleted` / `error.response` are set only when the bank's record
  shows the payment.
- **Approved but 3D failed.** When the bank approved the payment although the 3D authentication did not succeed, the
  response is `declined`; it carries `requires_manual_review: true` only when the bank's own record shows the
  payment. Do not ship the goods; reconcile in the bank panel.
- **Complete each order once.** Mark it paid in an idempotent update: a replayed callback maps to the same result
  and must not ship the goods a second time.

Use order ids of one fixed length (zero-padded numbers or UUID-based ids): one id must never be another id plus
extra characters at either end, for example `12` and `1200`, because the signed callback values have no separators.

## Order ids and amounts

- An order id is 1 to 64 letters, digits, `_` or `-`, starting with a letter or digit (a number is taken only as a
  safe non-negative integer); anything else throws `PosError` before a request is sent.
- Amounts are sent with up to two decimals, rounded like PHP `number_format`.

## Unclear answers

After a payment, post-authorization, 3D provision or refund, an answer without a result (an empty body, no result code)
throws `PosHttpError` and is never mapped to `declined`: the outcome is unknown, so keep the order pending and check
`pos.status(order)` before any retry. See [Outcome unknown](./security.md#outcome-unknown).

## Queries

`InterPosQuery` (see [queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)) offers
`customQuery(requestData, apiUrl?)`: a request in the bank's own format; `UserCode`, `UserPass` and `ShopCode` are
added from the account when you leave them out. There is no `history`.
