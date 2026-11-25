# Payment models

A payment model says who collects the card and how the result comes back. Every gateway offers a subset of the five
models below; the table at the end of this page lists them from the code. Gateway guides then describe the
bank-specific fields, so read this page first and the guide of your bank second.

| Constant | Value | Short name |
|---|---|---|
| `MODEL.NON_SECURE` | `regular` | Payment without 3D Secure |
| `MODEL.THREE_D_SECURE` | `3d` | 3D Secure with a separate provision |
| `MODEL.THREE_D_PAY` | `3d_pay` | 3D Pay |
| `MODEL.THREE_D_HOST` | `3d_host` | 3D Host |
| `MODEL.THREE_D_PAY_HOSTING` | `3d_pay_hosting` | 3D Pay Hosting (Asseco only) |

All code below uses a gateway created like this (see the README for the configs):

```ts
import { AccountFactory, MODEL, PosFactory, posProductionConfig, TX_TYPE } from 'typescript-pos'

const account = AccountFactory.createAssecoPosAccount('isbank', clientId, username, password, storeKey)
const pos = PosFactory.createPosGateway(account, posProductionConfig) // stateless: create once and share it
```

## The five models

### Non-secure (`MODEL.NON_SECURE`)

Your server sends the card to the bank and gets the result in the same call. There is no payer interaction and no
callback. Nobody checks the cardholder (no 3D Secure), so the usual protection against card-not-present chargebacks
does not apply; your bank contract decides whether you may use this model at all.

```ts
const response = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card)
if (response.status === 'approved') {
  // paid
}
```

A card is required for this call (`PosError` without one). The card passes through your server, so your PCI DSS scope
is the widest (SAQ D).

### 3D Secure (`MODEL.THREE_D_SECURE`)

The payer proves their identity to the card's bank, and your server then asks the payment bank to charge the card
("provision"). Two bank calls come from your server, one before the payer leaves and one after the payer returns.

1. `get3DFormData` returns what the browser needs to reach the bank's 3D page: a form object
   (`{ gateway, method, inputs }`), or an HTML string for a few gateways (see the table in the
   [iframe and popup guide](./3d-iframe-and-popup.md#what-get3dformdata-returns)).
2. The bank sends the payer's browser to your `success_url` or `fail_url` with a POST (a cross-site request: session
   cookies may be missing).
3. `payment(...)` with the callback body verifies the bank's signature, binds the result to your order and sends the
   provision request.

The card is needed at step 1. A few gateways need it again at step 3 (`PayFlexV4Pos`, see its guide); for the others
pass `null` there and never keep the card.

### 3D Pay (`MODEL.THREE_D_PAY`)

The payer's browser goes to the bank's gateway with a signed form, the bank checks the cardholder and charges the card
in one go, and the result comes back signed. There is no provision request: `payment(...)` only verifies, binds and
maps the callback. The card is either part of the form `get3DFormData` returns, or typed into card fields that post
straight to the bank (see "The card and the form" below).

### 3D Host (`MODEL.THREE_D_HOST`)

The bank hosts the whole payment page, card entry included. You pass no card; the form is a redirect (often a `GET`
without inputs, or a `POST` with only your signed order data). The result comes back like 3D Pay. This is the model
with the smallest PCI scope, together with 3D Pay Hosting and the hosted pages of PayTR, iyzico, Tosla, Param and
the VakıfBank Common Payment page.

### 3D Pay Hosting (`MODEL.THREE_D_PAY_HOSTING`)

The same idea as 3D Host for `AssecoPos`: the card is typed on the bank page, and the callback carries a final,
signed result. Pass no card.

## Which model to choose

| If you want... | Use |
|---|---|
| The smallest PCI scope and the least code | A hosted model: `3d_host` or `3d_pay_hosting`, or the gateway's hosted page |
| Your own checkout design and you accept PCI SAQ D | `3d` or `3d_pay` with the card on your page |
| Server-to-server payments (subscriptions, call centres) | `regular`, if your bank contract allows it |

PCI DSS in plain words (confirm the exact scope with your bank or a qualified assessor; this is not legal advice):

- **SAQ A**: card data never touches your pages or servers. The payer types the card on a page of the bank
  (3D Host, 3D Pay Hosting, hosted pages).
- **SAQ A-EP**: your own page shows the card fields, but they post straight from the browser to the bank. Your server
  never sees the card, yet your page's code decides where the card goes, so it is in scope.
- **SAQ D**: the card passes through your server (non-secure payments, the card sent with a 3D Secure request from
  your server, a card placed into the form your server renders).

Never store the CVV. Never log card data. Drop the card object as soon as the request is built.

## The call sequence

```ts
// 1. Persist the order on your server before the payer leaves (id, amount, currency, installment, URLs).
// 2. Build the 3D form.
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
// 3. Send the payer to the bank: render the form (see render3DFormHtml) or redirect.
// 4. The bank POSTs the browser to success_url / fail_url. Load the order from your own store, never by a field
//    the bank posted, and complete the payment with the callback body:
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

`get3DFormData(order, paymentModel, txType, card?, createWithoutCard?, formFormat?)`:

- `card` is required for `3d` and `3d_pay` unless `createWithoutCard` is `true`. Gateways that send the card from your
  server (see "The card and the form") always need it.
- `formFormat` is `FORM_FORMAT.ARRAY` (default) or `FORM_FORMAT.HTML` where the gateway offers it. A format the
  gateway does not offer throws `UnsupportedFormFormatError`.
- A model the gateway does not offer for the transaction type throws `UnsupportedTransactionTypeError`.

`payment(paymentModel, order, txType, card?, callbackBody?)` routes by model: `regular` sends the payment, the 3D
models need `callbackBody` (`PosError` without it) and call `make3DPayment`, `make3DPayPayment` or
`make3DHostPayment`. You may call those methods directly; a model the gateway does not have throws
`UnsupportedPaymentModelError`.

Rendering the form, redirecting, framing it or opening it in a popup is covered by the
[iframe and popup guide](./3d-iframe-and-popup.md). `render3DFormHtml` escapes the values for you.

### Handling the callback

```ts
import { HashMismatchError, OrderMismatchError, PosHttpError } from 'typescript-pos'

try {
  const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
  if (response.requires_manual_review) alertOps(response) // may have moved money: see security.md
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError) return false // forged, corrupted or unsigned: change nothing
  if (error instanceof OrderMismatchError) {
    if (error.paymentMayHaveCompleted) alertOps(error.response) // reconcile, then void or refund
    return false
  }
  if (error instanceof PosHttpError) return null // outcome unknown: keep the order pending, check pos.status(order)
  throw error
}
```

What the two flags mean and what each gateway does is defined in
[When money may have moved](./security.md#when-money-may-have-moved). Never mark an order failed from a callback you
could not verify, and mark it paid from the gateway's answer only, in an idempotent update.

## The card and the form

`createWithoutCard: true` (the fifth argument of `get3DFormData`) means "the browser collects the card". The library then
never writes a card into the form: a card you pass anyway is dropped. The hosted models never take a card, with or
without the flag: `3d_host` refuses a card (`PosError`); `3d_pay_hosting` drops it.

What the payer does next depends on the gateway: the bank page asks for the card, or your own page adds card fields
that post straight to the bank (PayTR and Tosla work like this). The gateway's guide names the field names.

The flag has no effect where the card never reaches the browser: `KuveytPos`, `VakifKatilimPos` (3D Secure),
`ParamPos`, `IyzicoPos` (3D Secure), `PosNetPos`, `PayFlexV4Pos` and `PayFlexCPV4Pos` send the card from your server to
the bank (or have no card at all). In those flows the card passes through your server and `3d` is a SAQ D flow.

## Which gateway offers which model

Generated from each gateway's `supportedTransactions` table. `pay` is `TX_TYPE.PAY_AUTH`.

| Gateway | Non-secure | 3D Secure | 3D Pay | 3D Host | 3D Pay Hosting |
|---|---|---|---|---|---|
| `AssecoPos` | yes | yes | yes | yes | yes |
| `PayFlexV4Pos` | yes | yes | no | no | no |
| `PayFlexCPV4Pos` | no | no | yes | yes | no |
| `GarantiPos` | yes | yes | yes | no | no |
| `AkbankPos` | yes | yes | yes | yes | no |
| `PosNetPos` | yes | yes | no | no | no |
| `PosNetV1Pos` | yes | yes | no | no | no |
| `PayForPos` | yes | yes | yes | yes | no |
| `InterPos` | yes | yes | yes | yes | no |
| `KuveytPos` | yes | yes | no | no | no |
| `VakifKatilimPos` | yes | yes | no | yes | no |
| `ToslaPos` | yes | no | yes | yes | no |
| `ParamPos` | yes | yes | yes | no | no |
| `Param3DHostPos` | no | no | no | yes | no |
| `PayTrPos` | yes | no | yes | yes | no |
| `IyzicoPos` | yes | yes | no | yes | no |

You can ask a gateway class instead of reading a table:

```ts
import { GarantiPos, MODEL, TX_TYPE } from 'typescript-pos'

GarantiPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST) // false
```

Pre-authorization has its own table: see [Pre-authorization and capture](./pre-auth-and-capture.md#which-gateway-offers-what).

## Common order fields

| Field | Notes |
|---|---|
| `id` | Your order id: 1 to 64 letters, digits, `_` or `-`, starting with a letter or digit. A number is accepted only as a safe non-negative integer. Some banks are stricter (the POSNET gateways allow 20 characters, VakıfBank Common Payment no `_`). Anything else throws `PosError` before a request is sent. Use ids of one fixed length. |
| `amount` | Major units (`10.5` is 10,50 TL). |
| `currency` | `CURRENCY.TRY` (default), `USD`, `EUR`, `GBP`, `JPY`, `RUB`, as far as the bank accepts them. |
| `installment` | `0` for a single payment, otherwise the instalment count. |
| `success_url`, `fail_url` | Public HTTPS addresses for 3D models. They may be the same URL. |
| `ip` | The payer's address; some gateways require it (see the gateway guide). |
| `lang` | `LANG.TR` or `LANG.EN`, the language of the bank page. |

Some gateways ask for more (KuveytPos, ParamPos, PayTrPos and IyzicoPos need customer or basket data); their guides list
them. Missing values are never sent as `"undefined"`: they throw `PosError`.

## Next

- [After a payment: cancel, refund, status and history](./after-payment.md)
- [Pre-authorization and capture](./pre-auth-and-capture.md)
- [Security and production checklist](./security.md)
