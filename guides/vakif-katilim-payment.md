# VakifKatilimPos payments (Vakıf Katılım)

Gateway `VakifKatilimPos`, bank key `vakif-katilim`. Complete compile-checked code:
[`examples/vakif-katilim-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/vakif-katilim-3d-host.ts).

Status: unit-tested; the request and callback hashes and the kuruş amount conversion are differential-tested against
PHP built-ins (1,000 random sets each, 0 mismatches).

## Bank and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createBoaPosAccount(
  'vakif-katilim', // key of `banks` in the config
  merchantId,
  username,
  customerNumber,
  password, // the API password: it signs requests and verifies callbacks
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created. `success_url` and `fail_url`
are required for the 3D models; use public HTTPS URLs without `localhost`.

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Host | `MODEL.THREE_D_HOST` | The bank page collects the card; nothing card-related touches your server. |
| 3D Secure | `MODEL.THREE_D_SECURE` | Your server posts the card to the bank, shows the bank's 3D page, and after the callback sends the provision. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) is available for non-secure only; `TX_TYPE.PAY_POST_AUTH` closes it.
Other operations: `status`, `cancel`, full `refund` and `orderHistory` (a date range). **Partial refunds are refused**
(`UnsupportedTransactionTypeError`): the bank's refund request carries no amount, so a partial one would refund
everything. Use a full refund or a cancel. Pass `transaction_type: 'pre'` on the order when you cancel or refund a
pre-authorization.

## 3D Host flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) and tie it to the customer's session.
2. `pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)` returns
   `{ gateway, method: 'POST', inputs }`. Render a form that posts `inputs` to `gateway` and submit it automatically.
3. The customer pays on the bank's page; the bank POSTs the browser to your `success_url` or `fail_url`.
4. Load the order from the customer's session and call
   `pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)`.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

> **Warning: the 3D Host form carries your hashed API password.** That is how the bank's page works, so anyone who
> loaded the page can sign callbacks. The library therefore never trusts a 3D Host callback by itself: every approval
> is confirmed with one status request, and only the bank's record decides. Ask the bank to restrict the API to your
> server IP addresses; prefer 3D Secure when that is not possible.

Every approved 3D Host payment is confirmed with that status request before it is returned: the bank's record must
hold exactly one order for this order id, successful and not a non-secure sale, with your amount and currency, no
cancelled or refunded amount and an authorization code. The result takes its amount, currency and references from that
record. Expect one extra request per approved payment. When the bank does not confirm, the call throws
`OrderMismatchError` with `paymentMayHaveCompleted: true` and `error.response` set. A transport error of the status
request (`PosHttpError`) propagates as is and also means the outcome is unknown: keep the order pending and re-check
with `pos.status(order)`.

Because a forger can trigger them, `requires_manual_review` and `paymentMayHaveCompleted` alerts from 3D Host are not
proof of a payment: re-query `pos.status(order)` before you ship goods or refund.

**Installments.** The bank page can offer installments, and the form carries none. Pass `installment: 0` to enforce a
single payment, or disable installments on the bank side. The installment is compared only when your order states one.

## 3D Secure flow

As for Kuveyt Türk: `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)` posts the card from your
server and returns the bank's HTML page (untrusted markup: serve it as its own response, never merge it into yours;
never store the card). The bank posts the result to your `success_url` or `fail_url`, and
`pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)` sends the provision. The provision is built
from your order; the callback only lends the bank's session value.

## Callback handling

- **The signature is always verified.** A callback that carries `HashData` is verified for every outcome; a wrong
  hash throws `HashMismatchError`. The order id, the response code and the bank's order id are the only signed
  fields: amount and currency are unsigned and are bound to your order. A callback value that is not a plain string is
  rejected before anything else.
- **Unsigned callbacks** can only become a decline (`require_3d_hash: true` rejects unsigned declines too), carry no
  callback value except bounded decline reasons, and never provision, confirm or set `requires_manual_review`.
- **The callback is bound to the order.** The signed order id must equal the order's (`OrderMismatchError`, nothing
  is sent). For 3D Secure the provision answer must name your order, amount and currency, otherwise
  `OrderMismatchError` with `paymentMayHaveCompleted` and the result attached: alert, then cancel or refund. A signed
  decline is not bound to your order; never use its `order_id` to look up an order.
- **Unclear answers.** After a provision, sale, pre-authorization or its close, an empty or unclear bank answer throws
  `PosHttpError` or `OrderMismatchError` (with `paymentMayHaveCompleted`). Keep the order pending and re-check with
  `pos.status(order)`; never retry blindly.
- **Hooks.** The request is signed before `onRequestDataPrepared` runs, so a hook that edits a field covered by
  `HashData` makes the bank reject the request. Use hooks to inspect, not to change signed values.
- **Echoed secrets.** The hashed password the bank echoes (`HashPassword`) is replaced with `***` in `all` and
  `3d_all`.
- **Complete each order once.** Mark it paid in an idempotent update.

## Order ids and amounts

- An order id is 1 to 64 letters, digits, `_` or `-`. Use ids of one fixed length (zero-padded or UUID-based): one id
  must never be another id plus extra characters, because the signed values have no separators.
- Amounts go to the bank in kuruş, rounded like PHP `number_format` (`1.15` becomes `115`).

## Order history

`pos.orderHistory({ start_date, end_date })` lists the orders of a date range (Türkiye time); `auth_code` optionally
filters by authorization code.

## Queries

`VakifKatilimPosQuery` offers `customQuery` and `history`, see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md). A custom query needs an `apiUrl` on
the bank's origin.
