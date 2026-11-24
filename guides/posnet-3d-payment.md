# Yapı Kredi POSNET payments (3D Secure, non-secure)

Gateway `PosNetPos`, bank key `yapikredi` (the bank's XML service with the bank-side decryption of the 3D result).
Complete compile-checked code:
[`examples/posnet-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/posnet-3d-secure.ts).

Status: unit-tested; the request MAC, the response MAC, the kuruş amount and the order-id padding are
differential-tested against PHP built-ins (1000 random inputs each, 0 mismatches).

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | Your server registers the card with the bank and gets the bank form; the customer authenticates; after the callback you call `payment`, which asks the bank to resolve the result and sends the provision request. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Sale (`TX_TYPE.PAY_AUTH`) and pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) work with both models;
`TX_TYPE.PAY_POST_AUTH` captures a pre-authorization. `pos.status()`, `pos.cancel()` and `pos.refund()` (full or
partial) are available. The bank has no order history request, and 3D Pay and 3D Host do not exist for this
gateway: they reject with `UnsupportedTransactionTypeError` / `UnsupportedPaymentModelError`.

## Configuration and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createPosNetPosAccount(
  'yapikredi', // key of `banks` in the config
  merchantId,
  terminalId, // note the order: terminal id comes before the POSNET id
  posNetId,
  encKey, // the 3D encryption key; needed for 3D Secure
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

- Merchant id, terminal id and POSNET id are required. The encryption key is optional when the account is created
  but required for 3D Secure. A blank value for any of them throws `MissingAccountInfoError`, so nothing is ever
  signed or sent with a missing value.
- The encryption key signs and verifies the 3D data. Keep it, like every other credential, out of your logs and
  your front-end code.
- `success_url` is required for the 3D form. The bank posts every outcome there, a failed authentication included;
  `fail_url` is not used. Banks and their firewalls usually need public HTTPS URLs without `localhost`.

## Flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) on your server and store it under an
   unguessable token you put in the callback URL before redirecting.
2. `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)` sends the card from **your server** to
   the bank and returns `{ gateway, method: 'POST', inputs }`. Your server handles card data at this step, so PCI DSS
   scope applies; never store the card (not in your session, not in your database). A card is always required: this
   gateway cannot build a form without one. Render a form that posts `inputs` to `gateway` and submit it
   automatically.
3. The customer authenticates; the bank POSTs the browser to your `success_url` with three opaque packets
   (`MerchantPacket`, `BankPacket`, `Sign`).
4. Look the order up by an unguessable token you put in the callback URL (the callback is a cross-site POST, so a
   session cookie may be missing) and call
   `pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. No card is needed after the
   redirect, so pass `null`.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

## Callback handling

- **You cannot verify the browser callback yourself, and the library does not trust it.** It asks the bank to decrypt
  the packets, verifies the bank's MAC over the decrypted result and only then sends the provision request. The
  MAC check cannot be switched off (`require_3d_hash` has no effect here). A wrong MAC, or decrypted fields in an
  unexpected format, throws `HashMismatchError`.
- **The result is bound to the order.** Before anything is charged, the order id, amount, currency and installment
  count the bank decrypted must be this order's; otherwise `OrderMismatchError` is thrown and nothing has been
  charged. Look the order up by the unguessable token in your callback URL, never by a field of the callback.
- **A failed 3D never charges.** A callback whose 3D status is not 1 to 4 is mapped as `declined` without a provision
  request. Half 3D (`md_status` 2 to 4) continues as the bank allows. On a declined result, the echoed remote order
  id, amount and currency come from the bank's answer before the MAC check, so do not treat them as authoritative:
  use your own order.
- **Replays.** Posting the same packets again is refused by the bank at provision time. Still, complete each order
  once: mark it paid in an idempotent update.
- **Unexpected errors.** A network error (`PosHttpError`, timeout) during provisioning means the outcome is unknown:
  keep the order pending and re-check it with `pos.status(order)`.

## Order ids

- 1 to 20 characters: letters, digits, `_` or `-`. The library pads the id with zeros to the length the bank
  wants, so two ids that differ only in leading zeros are the same order for the bank. Use ids of one fixed length
  (zero-padded numbers or UUID-based) and one id per attempt.
- Status, cancel and refund find 3D orders under the bank's own prefix; the library adds it. They need
  `payment_model` in the order: it defaults to `3d`, so pass `payment_model: 'regular'` (`MODEL.NON_SECURE`) for
  orders paid without 3D.
- Request values must not contain `&` or `%`, and must fit ISO-8859-9 (the bank reads the XML as sent). Such a value
  is rejected with `PosError` before anything leaves your server; Turkish letters are fine.

```ts
await pos.status({ id: orderId })
await pos.cancel({ id: orderId, payment_model: 'regular' })
await pos.refund({ id: orderId, amount: 25, currency: 'TRY', order_amount: 100 }) // partial: amount < order_amount
// capture a pre-authorization: `preAuthResponse` is the response of the pre-authorization
const capture = { id: orderId, amount: 100, currency: 'TRY', ref_ret_num: preAuthResponse.ref_ret_num }
await pos.payment(MODEL.NON_SECURE, capture, TX_TYPE.PAY_POST_AUTH, null)
```

## Queries

`PosNetPosQuery` offers `customQuery` only (see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)): your fields are sent as the
bank's XML, with `mid` and `tid` added when you did not set them.

## Good to know

- Amounts are sent in kuruş, rounded to two decimals like PHP `number_format`; an amount of 1e13 or more is
  rejected.
- Bank times without a UTC offset are Türkiye time (UTC+03:00).
- A blank or missing order id or amount is rejected with `PosError`, never sent as `"undefined"`.
