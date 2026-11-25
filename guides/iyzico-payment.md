# IyzicoPos payments (iyzico)

Gateway `IyzicoPos`, bank key `iyzico`. Complete compile-checked code:
[`examples/iyzico-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/iyzico-3d-host.ts).

Status: unit-tested; the request authorization header and the callback and answer signatures differential-tested
against PHP (0 mismatches in 1,000 random sets each).

## Account and configuration

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createIyzicoPosAccount(
  'iyzico', // key of `banks` in the config
  apiKey,
  secretKey, // the secret key never leaves your server
  // subMerchantKey, // optional, for marketplace sub-merchants
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Take the keys from the iyzico merchant panel (sandbox keys from the sandbox panel). The secret key signs every request
and verifies iyzico's answers. `posTestConfig.banks.iyzico` points at the sandbox host and
`posProductionConfig.banks.iyzico` at the live one. Empty or blank keys throw `MissingAccountInfoError`.

## Models and operations

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Host (checkout form) | `MODEL.THREE_D_HOST` | The card is entered on iyzico's page. Recommended: your server never sees it. |
| 3D Secure | `MODEL.THREE_D_SECURE` | The card goes from your server to iyzico, the payer confirms on the bank's page. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server sale. |

Offered operations: payment (`TX_TYPE.PAY_AUTH`) and pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) for all three models,
post-authorization (`TX_TYPE.PAY_POST_AUTH`), `cancel`, `refund` (partial when `order_amount` is set and higher than
`amount`), `status` and `orderHistory`. iyzico has no 3D Pay model. Queries are in the
[queries guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md).

## The order

| Field | Notes |
| --- | --- |
| `id` | Letters, digits, `_` and `-`, at most 64 characters, unique per attempt. It is used as the conversation id **and** the basket id. |
| `amount`, `currency` | Major unit (`10.5` is 10,50 TL, at most two decimals); `TRY`, `USD`, `EUR`, `GBP`, `JPY` or `RUB`. |
| `installment` | `1` to `12` (API models). |
| `success_url` | Your callback URL: the browser (3D Secure) or iyzico (3D Host) posts the result there. |
| `lang`, `payment_channel` | Optional. |
| `enabled_installments` | 3D Host: the plans the checkout page offers. |
| `buyer` | `{ id, name, surname, identity_number, email, registration_address, city, country, ip, gsm_number?, zip_code?, registration_date?, last_login_date? }` |
| `billing_address` | `{ contact_name, city, country, address, zip_code? }`, required. |
| `shipping_address` | Same fields; required when an item is `PHYSICAL`. |
| `basket_items` | `[{ id, name, category1, category2?, item_type: 'PHYSICAL' \| 'VIRTUAL', price }]`. The prices **must add up to `amount` exactly**; this is checked before anything is sent. |

A missing or invalid field throws `PosError` before any request leaves your server.

## 3D Host (recommended)

```ts
const html = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
// -> iyzico's checkout script, to embed in your page

const link = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true, 'array')
// -> { gateway: 'https://...', method: 'GET' } to redirect the browser to
```

Never pass card data for 3D Host: the call throws `PosError`. The card is entered on iyzico's page (PCI SAQ A).
iyzico then posts a `token` to your `success_url`:

```ts
const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
```

The token alone proves nothing, so the library asks iyzico for the signed checkout record of that token, verifies its
signature and binds it to your order (basket id, conversation id, token, amount). The charged `amount` in the result may
be higher than the order's when the payer picked an installment plan that carries a fee. Expect this extra request on
every callback.

## 3D Secure

```ts
import { CreditCardFactory } from 'typescript-pos'

const card = CreditCardFactory.createForGateway(pos, number, year, month, cvv, holderName)
const page = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
// -> the bank's HTML page: send it to the browser as it is
```

3D Secure needs the card even though the page comes from iyzico (`createWithoutCard` does not help), and it accepts
HTML only (`formFormat: 'array'` throws `UnsupportedFormFormatError`). Drop the card as soon as the page is built and
never store or log it.

The bank page ends in a POST to your `success_url`:

```ts
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)
```

A callback with a `signature` is always verified. Only a signed `success` with 3D status `1` and a numeric payment id
leads to the authorization request, which carries that signed payment id and **your** order's amount, currency and
basket id. Any other signed callback is a decline and nothing is sent. A callback without a signature never approves.

## Results and errors

Every approval comes from an iyzico-signed answer that is bound to your order: conversation id, basket id, payment id,
currency, amount and phase (`AUTH`, `PRE_AUTH`, `POST_AUTH`). An unsigned or unverifiable approval is never returned.

- `approved`: the money is taken (or held, for a pre-authorization).
- `declined`: iyzico refused it. A decline carries your own order id and iyzico's bounded code and text.
- `declined` with `requires_manual_review: true`: iyzico holds the payment for fraud review (`fraudStatus` other than
  `1`), or reports a failed 3D check on a payment that went through. **Do not ship.** Wait for iyzico's decision,
  reconcile in the iyzico panel and with `status()` / `orderHistory()`.
- `OrderMismatchError`: the signed answer names another order, amount, currency or phase. With
  `paymentMayHaveCompleted: true` the payment may have moved for something else than your order: review it and refund.
  Without a `response` it means a callback of another order, or a checkout of another order, reached the handler.
- `HashMismatchError`: a forged or broken signature.
- `PosHttpError` after a money request (sale, authorization, capture, cancel, refund): the outcome is unknown. iyzico
  answered nothing usable, or an approval that cannot be verified.

**An unclear answer after a money request is never a decline.** Keep the order pending, call `pos.status(order)` (or
`orderHistory`), and do not retry blindly: a retried sale charges twice and a retried refund refunds twice.

## Callback handler rules

```ts
async function callback(body: Record<string, string>, order: PosOrder) {
  try {
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    await storeOnce(order.id, response) // idempotent
  } catch (error) {
    // see the example for the branches
  }
}
```

- Load the order from **your** database (the `token` or the payer's session tells you which) and pass it in. Amount and
  currency always come from your order, never from the body.
- **Handle callbacks idempotently** and complete an order once. The library keeps no state, and callbacks can be
  replayed.
- **Never downgrade a paid order** because a later callback says declined: forged tokens and replays can produce
  declines. Use a decline's `order_id` only as the order you were already handling.
- Show the payer a neutral page and take decisions from the stored result. Escape any bank text you display.

## Other transactions

```ts
// Pre-authorization (non-secure), then capture with iyzico's payment id
const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card)
await pos.payment(MODEL.NON_SECURE, { ...order, transaction_id: pre.transaction_id }, TX_TYPE.PAY_POST_AUTH)

const paid = { ...order, transaction_id: paymentId } // iyzico's payment id from your stored result
await pos.cancel(paid) // same day, before settlement
await pos.refund(paid) // partial: set amount to the part and order_amount to the whole
const detail = await pos.status(order) // by order id, or add transaction_id
const records = await pos.orderHistory(order)
```

`status` reads iyzico's payment detail, which does not show cancels and refunds. Use `orderHistory` for those (it is a
report: its rows never confirm a payment). Cancel and refund need iyzico's payment id as `transaction_id` (the signed id in your stored result); a refund also
needs the order's `currency`.

## Hooks

`onRequestDataPrepared` may change any request field: the client computes the authorization header after the hook from
the exact bytes it sends.

## Security notes

- The secret key signs requests and checks answers; it is masked in logs and errors. The `Authorization` header and card
  fields are masked too.
- Never store card data. Use 3D Host where you can.
- Only `https:` endpoints are used and redirects are never followed.
