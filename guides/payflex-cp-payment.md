# VakıfBank Common Payment (3D Host / 3D Pay)

Gateway `PayFlexCPV4Pos`, bank key `vakifbank-cp`. Complete compile-checked code:
[`examples/payflex-cp-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/payflex-cp-3d-host.ts).

Status: unit-tested.

## What it is and PCI scope

Common Payment is a card page hosted by the bank. You register the payment, redirect the customer, and the bank
sends the browser back to your success or fail URL. With **3D Host** the card is typed on the bank page, so card data never reaches your server (PCI DSS SAQ A). With
**3D Pay** you pass a `CreditCard` to `get3DFormData`, which sends the card to the bank through your server; that puts
you under a larger PCI scope (SAQ D), so prefer 3D Host unless your agreement requires 3D Pay.

## Setup

```ts
import { AccountFactory, PosFactory, posProductionConfig } from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', merchantId, password, terminalNo)
const pos = PosFactory.createPosGateway(account, posProductionConfig)
```

- The account is the same `PayFlexPosAccount` as for `PayFlexV4Pos`. The bank key `vakifbank-cp` selects the Common Payment
  endpoint (`posTestConfig.banks['vakifbank-cp']` for the test environment).
- `success_url` and `fail_url` must be public HTTPS URLs without `localhost` (the bank WAF rejects them). The bank may
  also need your server IP to be whitelisted.
- `require_3d_hash` does not apply: the callback carries no signature. Protection comes from the server-side result
  query and the order binding described below.

## Flow

1. Persist the order on your server and create a short random token that maps to it. Put the token in the
   `success_url` / `fail_url` query string. Also create a new `transaction_id` for this attempt (for example
   `randomUUID().replaceAll('-', '')`, 32 characters) and store it with the order (see "Bind the attempt to the
   order" below).
2. `pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)` registers the payment with the bank and returns
   `{ gateway, method: 'GET', inputs: { Ptkn } }`. Redirect the browser to `gateway?Ptkn=...`. For 3D Pay pass the
   card as the fourth argument. If the bank does not
   accept the registration it throws `PosError`.
3. The customer pays on the bank page; the bank sends the browser to your success or fail URL.
4. Load the order using your token (never from the callback body), including the stored `transaction_id`, and call
   `pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. Use `MODEL.THREE_D_PAY` when your
   contract is 3D Pay, and `TX_TYPE.PAY_PRE_AUTH` for a pre-authorization.

The callback data is informational only. The gateway never believes it: it asks the bank's transaction query and uses
only that answer to decide the status, both for approval and for failure. The query uses the order's own
`transaction_id` / `payment_token` when you pass them, otherwise the `TransactionId` / `PaymentToken` of the callback.
When there is nothing to query (no id on the order or in the callback), the result is `declined` without any request.

## Bind the attempt to the order

Give every payment attempt its own `transaction_id` and keep it with the order:

```ts
import { randomUUID } from 'node:crypto'

const transactionId = randomUUID().replaceAll('-', '') // 32 letters and digits
await saveAttempt(orderId, transactionId)
const form = await pos.get3DFormData({ ...order, transaction_id: transactionId }, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
```

Alternatively store `form.inputs.Ptkn` and pass it back as `order.payment_token`. Pass the stored value back on the
order when the callback arrives. The gateway then queries that id only, and a callback that names a different
`TransactionId` or `PaymentToken` is rejected with `OrderMismatchError` (`field: 'transaction_id'`,
`paymentMayHaveCompleted: false`) before any request. Without a stored id, someone who replays the callback of an
earlier approved payment of the same order id and amount (for example one that was later cancelled or refunded) can
make it look approved again, because the transaction query does not report later cancels or refunds. This matters
most when you reuse order ids after a failed or cancelled attempt.

Use the same stored value for `pos.status(...)` when the callback never arrives.

## Order fields

| Field | Notes |
| --- | --- |
| `id` | 1 to 64 letters, digits and `-`, starting with a letter or digit (no `_`); anything else is rejected with `PosError` before any request |
| `amount`, `currency` | Required; the bank answer is compared against them |
| `installment` | Number of installments, `0` for a single payment |
| `success_url`, `fail_url` | Required, public HTTPS |
| `lang` | Optional bank page language (defaults to the gateway config language, Turkish) |
| `transaction_id` | Unique id for this attempt (letters, digits, `-`, up to 40 characters). Generated when omitted, but set it yourself and store it with the order: completion and `status()` use it |
| `payment_token` | Optional on completion: the stored `form.inputs.Ptkn` of this attempt, used like `transaction_id` |

## What is checked

An approved query answer must belong to your order. The order id and the amount (in the cents sent to the bank) are
always compared, and so is the currency: an answer that carries no currency code is accepted only for TRY orders. The merchant id, transaction type, transaction id (the order's, otherwise the callback's) and
payment token (the order's) are compared when the bank answer carries them. A mismatch throws `OrderMismatchError`;
its `paymentMayHaveCompleted` is `true` because the bank approved something, so check the bank panel and void or
refund it if it is not yours. For a payment token mismatch the error's `expected` / `actual` describe the tokens
instead of carrying them, so the error can be logged as it is.

When the callback said the payment succeeded but the query does not confirm it, the result is `declined` with
`requires_manual_review: true`. Do not ship the goods; re-check later with `pos.status({ transaction_id })` and
reconcile in the bank panel.

A `PosHttpError` or a timeout while completing the payment is not a failed payment: the customer may have paid.
Keep the order pending and re-check it with `pos.status({ transaction_id })` using the id you stored.

The bank or the customer's browser may deliver the same callback more than once. A repeated legitimate callback for
the same order is confirmed again and returns `approved` again, so make "mark the order paid" idempotent (for example
update only orders that are still pending).

## Status query

`pos.status({ transaction_id })` or `pos.status({ payment_token })` returns the bank record of a payment. Use the
`transaction_id` you set on the order (or the stored payment token) so you can check an uncertain payment later,
also when the callback never arrives. An unknown transaction resolves to `declined`.

## Capture, cancel and refund

Common Payment itself offers sale, pre-authorization and the status query. Capture of a pre-authorization, cancel and
refund are done with a `PayFlexV4Pos` gateway (bank key `vakifbank`) using the same merchant credentials, with
`transaction_id` set to the `TransactionId` of the Common Payment response:

```ts
const v4Account = AccountFactory.createPayFlexPosAccount('vakifbank', merchantId, password, terminalNo)
const v4 = PosFactory.createPosGateway(v4Account, posProductionConfig)
await v4.cancel({ transaction_id: transactionId, ip: customerIp })
```

Calling `post`, `cancel` or `refund` on `PayFlexCPV4Pos` throws `UnsupportedTransactionTypeError` with this hint.

## Half-secure payments

By default the registration sends `AllowNotEnrolledCard: 'false'`: the bank charges only after full 3-D Secure
authentication. If your agreement allows cards that are not enrolled in 3-D Secure, switch it on with a hook:

```ts
const pos = PosFactory.createPosGateway(account, posProductionConfig, {
  hooks: {
    onRequestDataPrepared: [
      (event) => {
        event.requestData.AllowNotEnrolledCard = 'true'
      },
    ],
  },
})
```

Mind the risk: for such payments the liability for fraud and chargebacks usually moves from the bank to you.
