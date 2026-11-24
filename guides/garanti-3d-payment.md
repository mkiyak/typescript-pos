# Garanti BBVA payments (3D Secure, 3D Pay, non-secure)

Gateway `GarantiPos`, bank key `garanti`. Complete compile-checked code:
[`examples/garanti-3d-pay.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/garanti-3d-pay.ts).

Status: unit-tested; the request signature and the 3D hashes are differential-tested against PHP built-ins (1000
random inputs each, 0 mismatches).

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | The card is sent to the bank's 3D page from your server. After the callback you call `payment`, which sends the provision request. |
| 3D Pay | `MODEL.THREE_D_PAY` | The bank charges during the 3D step; the callback already carries the result. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) is available for all three models. `TX_TYPE.PAY_POST_AUTH` captures it and
needs the `ref_ret_num` of the pre-authorization. 3D Host is not offered for Garanti. The card number reaches your
server in every model, so PCI DSS scope applies.

## Configuration and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createGarantiPosAccount(
  'garanti', // key of `banks` in the config
  merchantId,
  provisionUser, // user that signs payment requests
  provisionPassword,
  terminalId,
  storeKey, // 3D secret key, needed for 3D Secure and 3D Pay
  refundUser, // needed for cancel and refund
  refundPassword,
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

- `posTestConfig.banks.garanti` sets `test_mode: true`, so every request carries `Mode TEST`, which the Garanti test
  environment needs.
- 3D Secure and 3D Pay need the store key to sign the form and to verify the callback. Cancel and refund need the
  refund user and password; without them the call fails with `MissingAccountInfoError` before anything is sent.
- `success_url` and `fail_url` are required for the 3D form. Banks and their firewalls usually need public HTTPS URLs without `localhost`.

## Flow (3D Pay and 3D Secure)

1. Persist the order (`id`, `amount`, `currency`) on your server before redirecting.
2. `pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)` returns
   `{ gateway, method: 'POST', inputs }`. Render a form that posts `inputs` to `gateway` and submit it automatically.
   The card is required for both 3D models.
3. The customer authenticates; the bank POSTs the browser to your `success_url` or `fail_url`.
4. Load the order by id on the server and call
   `pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. For 3D Secure the call is the same
   with `MODEL.THREE_D_SECURE`; the library then sends the provision request. Pass `null` as the card in both cases: the
   card is not needed after the redirect, so do not keep it (store it neither in your session nor in your database)
   once `get3DFormData` has built the form.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

Use fixed-length order ids (zero-padded numbers or UUID-based ids) rather than ids that can be a prefix of one
another, such as `ORDER1` and `ORDER12`. The signed callback concatenates its fields, so ids of one length leave no
ambiguity about where the order id ends.

## Callback handling

- **The signature cannot be switched off.** The callback carries a `hash` over the fields named in `hashparams`. A
  signed callback must name the bank's fixed field list and have well-formed outcome fields, otherwise the call
  throws `HashMismatchError`. Comparisons are constant time.
- **Unsigned callbacks never approve.** The bank sends some error callbacks without a signature. In 3D Pay such a
  callback is accepted only as a decline; one that claims a completed payment is a `HashMismatchError`. With
  `require_3d_hash: true` in the bank config every unsigned callback is rejected. In 3D Secure only callbacks that are
  not 3D-successful (no money moves) may skip the signature check; they map as declined without any request.
- **The callback is bound to the order.** `clientid` must equal the terminal id and `oid` must equal `order.id`
  (a signed callback must carry both). The echoed amount, currency and transaction type are compared with your order;
  `terminalid`, `terminalmerchantid` and the security level are compared only when the callback carries them. A
  mismatch throws `OrderMismatchError` (`field` names the value, including `terminal_id` and `payment_model`).
  - 3D Secure: every check runs before the provision request, so no payment exists and `paymentMayHaveCompleted` is
    `false`.
  - 3D Pay: the checks run on the bank's answer. When it reported a completed payment, `paymentMayHaveCompleted` is
    `true` and `error.response.requires_manual_review` is set: check the bank panel and void or refund it.
- **Approved but 3D failed.** When the bank authorized money although the 3D result is not successful, the response is
  `declined` with `requires_manual_review: true`. Do not ship the goods; reconcile in the bank panel.
- **`md_status`.** `1` is full 3D authentication and `2` to `4` are half 3D Secure results; the library treats both as
  3D success. If you accept only full authentication, check that the callback's `mdstatus` (trimmed) equals `'1'`
  before you call `payment`: on 3D Secure, `payment` sends the provision request, so a check on `response.md_status`
  afterwards comes too late.

A `PosHttpError` or timeout while completing a payment is not a failed payment: keep the order pending and re-check it
with `pos.status(order)`.

## Money operations

```ts
await pos.cancel({ id: orderId, ref_ret_num: refRetNum, currency: 'TRY' })
await pos.refund({ id: orderId, ref_ret_num: refRetNum, amount: 25, order_amount: 100 }) // partial
await pos.status({ id: orderId, currency: 'TRY', ip: customerIp })
await pos.orderHistory({ id: orderId, currency: 'TRY', ip: customerIp })
await pos.payment(MODEL.NON_SECURE, { ...order, ref_ret_num: refRetNum }, TX_TYPE.PAY_POST_AUTH, null)
```

`ref_ret_num` comes from the normalized response of the original payment. Cancel and refund use the refund user and
password of the account. A refund is partial when `amount` is lower than `order_amount`.

## Queries

`GarantiPosQuery` (see [queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)) offers:

- `history({ ip, start_date, end_date, page? })`: transactions of a date range. The bank allows at most 30 days
  between the two dates; pass them as `Date` objects, the library writes them in Türkiye time.
- `getBinList({ ip, bin?, card_class? })`: BIN records, optionally filtered by `bin` and `card_class` (`CARD_CLASS`).
- `customQuery(requestData)`: a request in the bank's own format, with the terminal data and signature added.

## Good to know

- Amounts are sent in kuruş (10,50 TL is `1050`), rounded like PHP `number_format`.
- Bank times without a UTC offset are Türkiye time (UTC+03:00).
- The order needs `id` and `amount`. The 3D form and the first payment request also need `ip`; a missing one is
  rejected with `PosError` before any request. The 3D Secure provision takes the customer IP from the callback, and
  `status`, `cancel`, `refund` and post-authorization default `ip` to an empty string.
