# Pre-authorization and capture

A **pre-authorization** reserves an amount on the customer's card without charging it. A **capture** (the bank calls
it post-authorization or provision closing) later turns the reservation into a charge, for the reserved amount or
less where the bank allows it. Typical uses are goods that are shipped after the order, hotels and rentals.

The library names them `TX_TYPE.PAY_PRE_AUTH` (`'pre'`) and `TX_TYPE.PAY_POST_AUTH` (`'post'`). Everything else works
as in [Payment models](./payment-models.md): only the transaction type changes.

## Reserve the amount

The pre-authorization uses the same calls as a payment, with the pre-authorization type. Which models a gateway offers
for it is in the table below.

```ts
import { MODEL, TX_TYPE } from 'typescript-pos'

// Without 3D Secure
const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card)

// With a 3D model: build the form and complete the callback like a payment
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_PRE_AUTH, card)
const preFrom3D = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_PRE_AUTH, null, callbackBody)
```

`pre.status === 'approved'` means the bank holds the amount. Store the whole result with your order: the capture
needs references from it (`ref_ret_num`, `transaction_id`, and for `VakifKatilimPos` the bank's own order id as
`remote_order_id`).

The same rules as for payments apply: a verified, order-bound callback for the 3D models, `PosHttpError` means the
outcome is unknown, and nothing is retried blindly (see [After a payment](./after-payment.md#when-the-answer-does-not-say-what-happened)).

## Capture

A capture is sent without a card and without a payer, so it always goes through the non-secure entry point, whatever
model the pre-authorization used:

```ts
const captured = await pos.payment(
  MODEL.NON_SECURE,
  { ...order, amount: 80, ref_ret_num: pre.ref_ret_num }, // capture 80 of the reserved amount
  TX_TYPE.PAY_POST_AUTH,
  null,
)
```

The order fields a capture reads, by gateway:

| Gateway | Fields |
|---|---|
| `AssecoPos` | `id`; `amount`; `pre_auth_amount` when you capture more than the reserved amount (sent to the bank as the original reservation) |
| `PayFlexV4Pos` | `transaction_id` of the pre-authorization, `amount`, `ip` (all required); `currency` |
| `GarantiPos` | `id`, `amount`, `ref_ret_num` of the pre-authorization; `currency`, `ip` optional |
| `AkbankPos` | `id`, `amount`, `ip`; `currency` |
| `PosNetPos`, `PosNetV1Pos` | `ref_ret_num` of the pre-authorization, `amount`; `currency`, `installment` |
| `PayForPos`, `InterPos` | `id`, `amount` |
| `ToslaPos`, `ParamPos` | `id`, `amount` |
| `VakifKatilimPos` | `id`, `remote_order_id`, `ip`; no amount is sent: the bank closes what it holds |
| `IyzicoPos` | `id`, `transaction_id` (iyzico's payment id from the pre-authorization), `amount`; `currency`, `ip` optional |

A gateway that is not in the table has no capture: `KuveytPos`, `PayTrPos` and `Param3DHostPos` have no
pre-authorization either. `PayFlexCPV4Pos` can reserve (3D Pay, 3D Host) but cannot capture: use a `PayFlexV4Pos`
gateway (bank key `vakifbank`) with the same credentials and `transaction_id` set to the Common Payment's
transaction id (see the [Common Payment guide](./payflex-cp-payment.md#capture-cancel-and-refund)).

A missing field throws `PosError` before any request is sent.

### What the library checks about the amount

Very little, on purpose: **the bank enforces the capture rules** (a limit above the reserved amount, a second capture,
an expired reservation).

- The library does not compare the capture `amount` with the amount of the pre-authorization on any gateway. It sends
  the amount you give, formatted for the bank, and a bank refusal comes back as `declined`.
- `AssecoPos` forwards the original reserved amount (`pre_auth_amount`) when `amount` is higher than it, as the bank
  asks.
- `VakifKatilimPos` sends no amount at all.
- A capture whose answer carries no result throws `PosHttpError` (outcome unknown: read `pos.status(order)` first).
  Tosla and iyzico also check that an approved answer names your order, and throw `OrderMismatchError` otherwise.

So keep the reserved and the captured amounts in your own records and compare them before you call `payment`.

## Cancel a reservation

A reservation that you will not capture is released with `cancel`. A few gateways must be told that the order is a
pre-authorization:

- `ParamPos`, `VakifKatilimPos`: `transaction_type: 'pre'` on the order (no amount is needed then).
- `PosNetPos`, `PosNetV1Pos`: `transaction_type: 'pre'`.

Details per gateway are in [After a payment](./after-payment.md#what-each-gateway-needs).

## Which gateway offers what

Generated from each gateway's `supportedTransactions` table. The model columns are for the pre-authorization
(`TX_TYPE.PAY_PRE_AUTH`); the last column says whether `TX_TYPE.PAY_POST_AUTH` exists.

| Gateway | Non-secure | 3D Secure | 3D Pay | 3D Host | 3D Pay Hosting | Capture |
|---|---|---|---|---|---|---|
| `AssecoPos` | yes | yes | yes | yes | yes | yes |
| `PayFlexV4Pos` | yes | yes | no | no | no | yes |
| `PayFlexCPV4Pos` | no | no | yes | yes | no | no (use `PayFlexV4Pos`) |
| `GarantiPos` | yes | yes | yes | no | no | yes |
| `AkbankPos` | yes | yes | yes | yes | no | yes |
| `PosNetPos` | yes | yes | no | no | no | yes |
| `PosNetV1Pos` | yes | yes | no | no | no | yes |
| `PayForPos` | yes | yes | yes | yes | no | yes |
| `InterPos` | yes | yes | yes | yes | no | yes |
| `KuveytPos` | no | no | no | no | no | no |
| `VakifKatilimPos` | yes | no | no | no | no | yes |
| `ToslaPos` | no | no | yes | yes | no | yes |
| `ParamPos` | yes | yes | no | no | no | yes |
| `Param3DHostPos` | no | no | no | no | no | no |
| `PayTrPos` | no | no | no | no | no | no |
| `IyzicoPos` | yes | yes | no | yes | no | yes |

Notes:

- `ParamPos` does a 3D pre-authorization in Turkish lira only.
- `ToslaPos` offers the pre-authorization with 3D Pay and 3D Host only.
- `VakifKatilimPos` offers it without 3D only.

Check in code, with the same table the gateway uses:

```ts
import { MODEL, ToslaPos, TX_TYPE } from 'typescript-pos'

ToslaPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE) // false
ToslaPos.isSupportedTransaction(TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE) // true
```

An unsupported combination throws `UnsupportedTransactionTypeError` before any request.

## Next

- [After a payment: cancel, refund, status and history](./after-payment.md)
- [Security and production checklist](./security.md)
