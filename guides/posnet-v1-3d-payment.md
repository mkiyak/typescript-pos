# Albaraka Türk POSNET payments (3D Secure, non-secure)

Gateway `PosNetV1Pos`, bank key `albaraka` (the bank's JSON API with a SHA-256 MAC on the 3D result). Complete
compile-checked code:
[`examples/posnet-v1-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/posnet-v1-3d-secure.ts).

Status: unit-tested; the 3D hash, the request hashes, the amount format and the callback MAC check are
differential-tested against PHP built-ins (1000 random inputs each, 0 mismatches).

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | The browser posts a form to the bank's 3D page; after the callback you call `payment`, which sends the provision request. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server request, no 3D step. |

Sale (`TX_TYPE.PAY_AUTH`) and pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) work with both models;
`TX_TYPE.PAY_POST_AUTH` captures a pre-authorization. `pos.status()`, `pos.cancel()` and `pos.refund()` (full or
partial) are available. There is no order history request, and 3D Pay and 3D Host do not exist for this gateway.

## Configuration and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createPosNetPosAccount(
  'albaraka', // key of `banks` in the config
  merchantId,
  terminalId, // note the order: terminal id comes before the POSNET id
  posNetId,
  encKey, // signs the 3D form and verifies the callback
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created. `success_url` is
required for the 3D form and the bank posts every outcome there, a failed authentication included; `fail_url` is
ignored. Public HTTPS URLs without `localhost` are usually required.

## Flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) on your server and tie it to the customer's
   session before redirecting.
2. Build the form. Two variants:
   - **Recommended: the bank page collects the card.**
     `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null, true)` (the last argument is
     `createWithoutCard`). Nothing card-related touches your server.
   - **With a card:** `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)`. The card number goes
     into hidden inputs of the form your page renders, so it reaches your server and the customer's browser page;
     PCI DSS scope applies. Never store it.
3. Render a form that posts `inputs` to `gateway`, and submit it automatically. The customer authenticates and the
   bank POSTs the browser to your callback URL.
4. Look the order up by an unguessable token you put in the callback URL (the callback is a cross-site POST, so a
   session cookie may be missing) and call
   `pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)`. No card is needed here, so pass
   `null`.

## Callback handling

- **The signature cannot be switched off.** The bank signs only the 3D result fields (`ECI`, `CAVV`, `MdStatus`,
  `MdErrorMessage`, `MD`, `SecureTransactionId`). The library always uses that fixed field list, never one named by
  the callback, and verifies the `Mac` in constant time. Only `MdStatus` 1 is a successful 3D; every other status
  is mapped as `declined` and no provision request is sent. A `Mac` that a declined callback carries must verify
  too; a wrong one throws `HashMismatchError`. A declined callback without a `Mac` is accepted as a decline unless
  you set `require_3d_hash: true`, which rejects it.
- **Signed fields must have the expected formats.** The bank joins them without separators, so the library pins
  their shapes (for example a two-digit `ECI`); a signed callback with malformed values throws `HashMismatchError`.
- **The callback is bound to the order.** The order id and amount must be echoed, and the currency, merchant and
  transaction type are compared whenever the callback carries them; any difference throws `OrderMismatchError`
  before the provision request, so nothing is charged. These echoes are not signed: they stop honest mix-ups and
  naive replays. The provision always charges **your order's own** amount, currency and installments; the bank
  checks the 3D session values itself.
- **Complete each order once.** Mark it paid in an idempotent update. A network error (`PosHttpError`, timeout)
  during provisioning means the outcome is unknown: keep the order pending and re-check it with `pos.status(order)`.
- Look the order up by the unguessable token in your callback URL, never by a field of the callback.

## Order ids

- 1 to 20 characters: letters, digits, `_` or `-`; the library pads them with zeros, so ids that differ only in
  leading zeros are the same order for the bank. Use ids of one fixed length and one id per attempt.
- Status, cancel and refund find 3D orders under the bank's `TDS_` prefix; the library adds it. They need
  `payment_model` in the order: it defaults to `3d`, so pass `payment_model: 'regular'` (`MODEL.NON_SECURE`) for
  orders paid without 3D.

```ts
await pos.status({ id: orderId })
await pos.cancel({ id: orderId, payment_model: 'regular' })
await pos.refund({ id: orderId, amount: 25, currency: 'TRY', order_amount: 100 }) // partial: amount < order_amount
```

## Queries

`PosNetV1PosQuery` offers `customQuery` only (see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)). The bank has one URL per
operation, so you must pass the full `apiUrl` of the operation, on the bank's own origin. Your JSON gets `ApiType`,
`ApiVersion`, `MerchantNo` and `TerminalNo` when missing, and a `MAC` over the fields named in your `MACParams`
list (colon separated names) when you did not set one.

## Good to know

- Amounts are sent in kuruş, rounded to two decimals like PHP `number_format`; an amount of 1e13 or more is
  rejected.
- Bank times without a UTC offset are Türkiye time (UTC+03:00).
- A blank or missing order id or amount is rejected with `PosError`, never sent as `"undefined"`.
