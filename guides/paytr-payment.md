# PayTrPos payments (PayTR)

Gateway `PayTrPos`, bank key `paytr`. Complete compile-checked code:
[`examples/paytr-3d-host.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/paytr-3d-host.ts).

Status: unit-tested; request tokens and the notification hash differential-tested against PHP (0 mismatches in 1,000
random sets); the basket JSON against PHP's `json_encode` (0 mismatches in 1,000 baskets).

## Account and configuration

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createPayTrPosAccount(
  'paytr', // key of `banks` in the config
  merchantId,
  merchantSalt, // both values are on the information page of the PayTR panel
  merchantKey, // the signing key: neither the salt nor the key ever leaves your server
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank values throw `MissingAccountInfoError`. PayTR has one host for test and live traffic: the test config
sets `test_mode: true`, which makes every request a test transaction. Never use it in production.

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Host (iFrame) | `MODEL.THREE_D_HOST` | Your server asks PayTR for a token; the payer's browser opens PayTR's payment page. Recommended. |
| 3D Pay (Direct API) | `MODEL.THREE_D_PAY` | A form on your page posts the card fields straight to PayTR. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server sale. It needs PayTR's Non3D permission. |

Offered operations: payment (`TX_TYPE.PAY_AUTH`), `status`, `refund` and partial refund. Pre-authorization,
post-authorization, cancel and order history are not offered (`pos.orderHistory` throws); use the
[history query](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md) to list records.

## The order

| Field | Notes |
| --- | --- |
| `id` | Unique per attempt, letters and digits only, at most 64 characters (PayTR documents letters and digits only). |
| `amount`, `currency` | Major unit (`10.5` is 10,50 TL); `TRY`, `USD`, `EUR`, `GBP` or `RUB`. |
| `installment` | `0`, or `2` to `12`. For 3D Host it is the highest plan the payer may pick. |
| `ip` | The payer's IP address. |
| `success_url`, `fail_url` | Where PayTR sends the payer's browser afterwards. |
| `lang` | `tr` or `en`. |
| `buyer` | `{ email, name, gsm_number }`, all required. |
| `billing_address` | `{ address }`, required. |
| `basket_items` | Optional list of `{ name, price, item_count }`; a price has at most two decimals. Without it one default row with the charged amount is sent. |

A missing required field throws `PosError` before anything is sent.

## How results arrive

PayTR reports the result **server to server**, in a POST to the notification URL you set in the PayTR panel. The
browser's success page receives no data (show "your payment is being processed"), and the fail page receives only a
message you may display. **Neither page ever confirms or changes an order**: only the signed notification does.

## 3D Host (recommended)

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
// -> { gateway: 'https://www.paytr.com/odeme/guvenli/<token>', method: 'GET' }
```

One signed token request goes from your server to PayTR. Use `gateway` as the `src` of an iframe (together with PayTR's
iframe resizer script) or redirect to it. The card is entered on PayTR's page, so your server never sees it (PCI SAQ A).
If PayTR refuses the token request, `get3DFormData` throws `PosError` with PayTR's reason.

## 3D Pay

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null, true)
// -> { gateway: 'https://www.paytr.com/odeme', method: 'POST', inputs: { ... } } (no card inside)
```

With `createWithoutCard: true` (the fifth argument) the form holds no card. Your page adds inputs named exactly
`cc_owner` (at most 50 characters), `card_number`, `expiry_month` (`01` to `12`), `expiry_year` (two digits) and `cvv`,
and the browser posts straight to PayTR, so card data never reaches your server. If you pass a card instead, its values
are placed in the returned inputs: render them into an auto-submitted form and never log or store them.

**HTML-escape every input name and value when you render the form.** The basket is JSON text and contains quotes, so an
unescaped value breaks the form.

Why 3D Host is recommended: the 3D Pay form, token included, is in the payer's browser, and the token signs neighbouring
values without separators. A payer can shift characters between fields (for example move a digit from the amount into
the e-mail address) and PayTR still accepts the form. The library cannot prevent that. The notification check does catch
it: a payment at another amount raises `OrderMismatchError` with `paymentMayHaveCompleted` (see below), and you then
refund or collect the difference. The 3D Host token request is made from your server and has no such gap.

## Notification handler

```ts
import { MODEL, OrderMismatchError, PayTrPos, TX_TYPE } from 'typescript-pos'

async function notificationUrl(body: Record<string, string>): Promise<'OK'> {
  const id = PayTrPos.notificationOrderId(body) // unverified: only to load the order
  const order = await loadOrder(id) // from your database, with the amount you stored
  try {
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    await storeOnce(order.id, response) // idempotent, see below
    return 'OK'
  } catch (error) {
    if (error instanceof OrderMismatchError && error.paymentMayHaveCompleted) {
      await recordForReview(order.id, error.response) // charged at another amount or currency
      return 'OK'
    }
    throw error // HashMismatchError or another PosError: answer an error status, not OK
  }
}
```

- Read the raw form body (`application/x-www-form-urlencoded`) into a flat record of strings and pass it as it is.
  `notificationOrderId(body)` only reads the order id so you can load your order; it is not verified and must be used
  for nothing else. Load the amount and currency from **your** order, never from the body.
- Use `MODEL.THREE_D_HOST` or `MODEL.THREE_D_PAY` (both take the same notification). A non-secure sale also produces a
  notification: handle it with `MODEL.THREE_D_PAY`.
- Answer the plain text `OK` (nothing else) once the result is stored, also for declines and for duplicates. PayTR
  repeats a notification until it receives `OK`.
- **Deduplicate by order id and complete each order once.** The library keeps no state: a repeated notification gives the
  same result every time. Act on the first verified result and never downgrade an approved order because a later
  notification says `failed`.
- On `HashMismatchError`, or an `OrderMismatchError` without `paymentMayHaveCompleted` (the wrong order was loaded, or a
  test payment reached a live gateway), answer an error status (not `OK`) and investigate; PayTR will retry. After
  recording an `OrderMismatchError` with `paymentMayHaveCompleted` for review, answer `OK`.

What is checked, in this order:

- The body must be a flat record of strings and not empty (an empty body is what the success page would have).
- A body **without** a `hash` is a browser return. It never approves anything: it is rejected with
  `HashMismatchError` when it reads as an approval or when `require_3d_hash` is set, and otherwise returned as a
  decline carrying only your order id and PayTR's failure text.
- A body **with** a `hash` is always verified (it cannot be disabled). The hash signs the order id, the status and the
  total amount in kuruş with your salt and key. A mismatch is `HashMismatchError`.
- The signed order id must be the order you passed, otherwise `OrderMismatchError` with `field: 'order_id'` (you loaded
  the wrong order).
- Only the status `success` approves. Any other verified status is a `declined` result.
- Test-mode notifications are refused on a live gateway: `OrderMismatchError` with `field: 'test_mode'` (a test payment
  moves no money, and one notification URL may serve a staging store with the same order ids).
- The signed total must equal the order amount. For an **installment order** it may be higher (the payer's plan may carry
  a fee); for any other order a higher total is a mismatch too. The result's `amount` is what was actually charged. The
  unsigned `payment_amount` and `currency`, when PayTR sends them, must also be your order's.

An `OrderMismatchError` with `field` `amount` or `currency` and `paymentMayHaveCompleted: true` means the signed
notification proves the payer was charged for this order at another amount or currency: alert someone and refund (or
collect the rest). The approved result is in `error.response`.

## Non-secure sales

`pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card)` sends one sale. Only `success` and `failed` are results.
PayTR may answer `wait_callback` (the result will come by notification), and an empty or unreadable answer does not say
whether money moved: all of these throw `PosHttpError`. Keep the order pending, wait for the notification or check
`pos.status(order)`, and never retry blindly. An approved answer for another order id or amount throws
`OrderMismatchError` with the result attached.

## Status and refund

`pos.status(order)` returns the query result: refunds are in `refund_amount`, the order's state in `order_status`.

`pos.refund(order)` refunds the full amount; set `order.order_amount` higher than `order.amount` for a partial refund,
and an optional `reference_no` to tell refunds apart. An approved answer must name your order and the refunded amount.
PayTR's answer word `error` (and `failed`) means PayTR processed the request and refused it: you get a `declined`
result with PayTR's `error_code` and `error_message`. Any other unclear answer throws `PosHttpError`: check
`pos.status(order)` (the refunds in `all.returns`, matched by `reference_no`) before you retry, because a retried
refund may refund twice. Never use `order_status` to decide on a second refund.

## Hooks, logs and cards

- Every request token covers the request's own fields. A hook that changes a signed field after the token is computed
  invalidates the request: PayTR refuses it, and nothing is ever sent signed over other values.
- Tokens, the merchant salt and key, and card fields are masked in logs and error snippets. Never store card data.
- PayTR's failure texts and bank messages are plain text but may contain markup: **HTML-escape them** when you display
  them.

## Queries

`PayTrPosQuery` offers `customQuery`, `history`, `getInstallmentRates` and `getBinList`, see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md).
