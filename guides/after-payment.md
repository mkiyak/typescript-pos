# After a payment: cancel, refund, status and history

Four operations work on a payment that already exists: `cancel`, `refund`, `status` and `orderHistory`. They are
methods of the gateway, not of the query object (see [queries](./queries.md) for requests that are not tied to one
order). Every call is stateless and returns its own result.

```ts
const cancelled = await pos.cancel(order)
const refunded = await pos.refund(order)
const state = await pos.status(order)
const records = await pos.orderHistory(order)
```

The `order` is a plain object like the one you paid with. Which of its fields each gateway reads is listed below,
because banks identify a payment differently: by your order id, by a reference the bank returned (`ref_ret_num`,
`transaction_id`, `remote_order_id`), or by both. Keep the normalised result of the payment next to your order so you
can pass those references back.

## Cancel or refund

- **`cancel`** voids a payment that the bank has not settled yet, usually within the same day. The customer's money is
  released.
- **`refund`** returns money after settlement. A refund is **partial** when `order.order_amount` (the original total)
  is set and `order.amount` is lower; then `amount` is the part to return.

Which one a bank accepts depends on its settlement timing. When a cancel is declined, a refund is the next step; when a
refund is declined for a payment of the same day, try a cancel. A few gateways have only one of them (see the table).

```ts
// full refund
await pos.refund({ id: orderId, amount: 100, currency: 'TRY' })

// partial refund: 25 of the original 100
await pos.refund({ id: orderId, amount: 25, order_amount: 100, currency: 'TRY' })
```

## What each gateway needs

Fields marked "optional" are used when present. Every `id` follows the order-id rule of the
[payment models guide](./payment-models.md#common-order-fields). Values that come from the payment's own result are
named after the result keys (`ref_ret_num`, `transaction_id`, `auth_code`, `remote_order_id`).

| Gateway | `cancel` | `refund` | `status` | `orderHistory` |
|---|---|---|---|---|
| `AssecoPos` | `id` | `id`; `amount`, `currency` (a refund without `amount` is a full one) | `id` | `id` |
| `PayFlexV4Pos` | `transaction_id`; `ip` optional | `transaction_id`, `amount`; `ip` optional | `id`; `transaction_id` optional | not offered |
| `PayFlexCPV4Pos` | not offered | not offered | `transaction_id` or `payment_token` | not offered |
| `GarantiPos` | `id`, `ref_ret_num`; `currency`, `ip` optional | `id`, `ref_ret_num`, `amount` | `id`; `currency`, `ip` optional | `id`; `currency`, `ip` optional |
| `AkbankPos` | `id` | `id`, `amount`; `currency` optional | not offered (use `orderHistory`) | `id` |
| `PosNetPos` | `ref_ret_num` or `id`; `payment_model`, `transaction_type`, `auth_code` optional | `ref_ret_num` or `id`, `amount`; `payment_model`, `currency` optional | `id`; `payment_model` optional | not offered |
| `PosNetV1Pos` | `ref_ret_num` or `id`; `payment_model` optional | `ref_ret_num` or `id`, `amount`; `payment_model` optional | `id`; `payment_model` optional | not offered |
| `PayForPos` | `id` | `id`, `amount` | `id` | `id` |
| `InterPos` | `id` | `id`, `amount` | `id` | not offered |
| `KuveytPos` | `id`, `remote_order_id`, `ref_ret_num`, `auth_code`, `transaction_id`, `amount` | the same | `id`; `remote_order_id`, `start_date`, `end_date` optional | not offered |
| `VakifKatilimPos` | `id`, `remote_order_id`, `amount` (not for a pre-authorization) | `id`, `remote_order_id` (full refund only) | `id` | `start_date`, `end_date`; `auth_code` optional |
| `ToslaPos` | `id` | `id`, `amount` | `id` | `id`, `transaction_date`; `page`, `page_size` optional |
| `ParamPos` | `id`, `amount` (not for a pre-authorization) | `id`, `amount` | `id` | not offered |
| `Param3DHostPos` | not offered (use `ParamPos`) | not offered (use `ParamPos`) | not offered (use `ParamPos`) | not offered |
| `PayTrPos` | not offered (use `refund`) | `id`, `amount`; `reference_no` optional | `id` | not offered (use `PayTrPosQuery.history`) |
| `IyzicoPos` | `id`, `transaction_id`; `ip` optional | `id`, `transaction_id`, `amount`; `currency`, `ip` optional | `id` or `transaction_id` (or both) | `id` or `transaction_id` (or both) |

Notes behind the table:

- `PosNetPos` and `PosNetV1Pos` find 3D orders under the bank's own prefix, which the library adds. `payment_model`
  defaults to `3d`: pass `payment_model: 'regular'` for a payment made without 3D. `transaction_type: 'pre'` cancels a
  pre-authorization.
- `ParamPos` and `VakifKatilimPos` cancel a pre-authorization with `transaction_type: 'pre'`; no amount is needed then.
  `VakifKatilimPos` takes the same field for a refund of a pre-authorization.
- `KuveytPos` and `VakifKatilimPos` send the bank's own order id as `remote_order_id`; it comes from the payment's
  result. A partial `KuveytPos` refund sends `amount` as the refunded part and `order_amount` as the original total.
- `IyzicoPos` identifies a payment by iyzico's payment id, which is `transaction_id` of the stored result, not your
  order id.
- A hosted `ParamPos` payment (`Param3DHostPos`) is cancelled, refunded and queried through a `ParamPos` gateway built
  from the `param-pos` config entry, with the bank's own order id as `id`. See the [Param guide](./param-payment.md).
- `PayFlexCPV4Pos` has no cancel or refund. Use a `PayFlexV4Pos` gateway (bank key `vakifbank`) with the same
  credentials and `transaction_id` set to the Common Payment's transaction id. See the
  [Common Payment guide](./payflex-cp-payment.md#capture-cancel-and-refund).
- `GarantiPos` cancel and refund need the account's refund user and password; without them the call throws
  `MissingAccountInfoError` before anything is sent.

Calling an operation a gateway does not have throws a `PosError` subclass (`UnsupportedTransactionTypeError`,
`UnsupportedPaymentModelError` or `NotImplementedError`). To check first:

```ts
import { AkbankPos, MODEL, TX_TYPE } from 'typescript-pos'

AkbankPos.isSupportedTransaction(TX_TYPE.STATUS, MODEL.NON_SECURE) // false: use orderHistory
```

## Gateway differences worth knowing

- **`AkbankPos`** has no status request: `pos.status()` rejects with `UnsupportedTransactionTypeError`. Read
  `pos.orderHistory(order)` instead.
- **`PosNetV1Pos`** refunds a 3D order in full only: the bank's lookup of a 3D order has no amount field, so a partial
  refund of one throws `UnsupportedTransactionTypeError` before any request, and a refund without `order_amount` returns
  the whole payment. Partial refunds work for orders paid without 3D.
- **`VakifKatilimPos`** refuses partial refunds (`UnsupportedTransactionTypeError`): the bank's refund request carries
  no amount, so a partial one would refund everything. Use a full refund or a cancel.
- **`IyzicoPos`**: `status` reads iyzico's payment detail, which does not show cancels and refunds. Use `orderHistory`
  for those; its rows never confirm a payment.
- **`PayTrPos`**: there is no cancel. A refund can carry an optional `reference_no` (letters and digits) that tells
  refunds apart. A repeated refund may refund twice: after an unclear answer read `pos.status(order)` and match
  `all.returns` by `reference_no` before you try again.
- **`ParamPos`**: cancelling a sale needs `amount` on the order; pass `transaction_type: 'pre'` to cancel a
  pre-authorization.
- **`PayForPos`**: a refund must fall into a different batch than the sale. Cancel a sale of the same day instead.
- **`InterPos`**: refund requests carry no currency field, so use refunds for sales in TRY.
- **`PayFlexV4Pos`**: cancel and refund send `ClientIp` empty when the order has no `ip`; pass it. A status `Search`
  answer with several records for one order is mapped as `declined` with empty fields: reconcile from your own
  records.

## The result you get back

Every result of `payment`, `status`, `cancel`, `refund` and `orderHistory` has these keys, on every gateway:

| Key | Type | Meaning |
|---|---|---|
| `status` | `'approved'` or `'declined'` | What the bank said about the request |
| `order_id` | `string` or `null` | The order id the bank reports |
| `proc_return_code` | `string` or `null` | The bank's result code (`'00'` is the usual success) |
| `error_code` | `string` or `null` | The bank's error code |
| `error_message` | `string` or `null` | The bank's error text |
| `all` | the decoded bank answer | Everything the bank sent, masked wherever the library logs it |

A key the bank did not send is `null`, never missing. Besides those, most results carry `transaction_id`,
`transaction_time`, `auth_code` and `ref_ret_num`; a `status` result adds `order_status`, `first_amount`,
`capture_amount`, `refund_amount`, `refund_time`, `cancel_time`, `installment_count`, `currency` and `masked_number`
where the bank reports them. An `orderHistory` result has `trans_count` and `transactions`, a list of records with the
keys of a status result.

`status: 'approved'` on a `status` or `orderHistory` result says the query succeeded. Read the state of the payment
itself from `order_status`, `refund_amount` and the records; the gateway guides name the values. `requires_manual_review`
can appear on payment results: see [When money may have moved](./security.md#when-money-may-have-moved).

## When the answer does not say what happened

A request that moves money can fail on the way back: a timeout, a gateway error page, or a body without a result. The
bank may have processed it. Retrying then can charge or refund twice.

The library does not turn such an answer into `declined`. After a payment, a provision, a capture or a refund whose
answer carries no result code (an empty body, a body without the result field, an unreadable page), it throws
`PosHttpError`. Treat that as **outcome unknown**:

```ts
import { PosHttpError } from 'typescript-pos'

try {
  return await pos.refund(order)
} catch (error) {
  if (!(error instanceof PosHttpError)) throw error
  // Do not retry. Keep your own record "refund requested, outcome unknown" and ask the bank.
  const state = await pos.status(order) // AkbankPos: pos.orderHistory(order)
  // Retry only when the bank shows no sign of the refund.
  return state
}
```

Rules:

- Never wrap payment, capture, cancel or refund calls in automatic retries (HTTP middleware, job queues).
- Look the transaction up with `status`, or `orderHistory` on `AkbankPos` (no status request) and for iyzico cancels and
  refunds, before any new attempt.
- A cancel is safer to repeat, because a payment cannot be cancelled twice. Most gateways still return `declined` for a
  cancel answer without a result; some (iyzico, for example) throw like for a refund. Check the state either way.
- `status` and `orderHistory` move no money. A transport error there is only a failed lookup: repeat it.

[Security guide, "Outcome unknown"](./security.md#outcome-unknown) has the full list of what throws on each gateway.

## Next

- [Pre-authorization and capture](./pre-auth-and-capture.md)
- [Payment models](./payment-models.md)
- [Queries](./queries.md), for history and reports that are not tied to one order
