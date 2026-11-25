# ParamPos and Param3DHostPos payments (Param)

Gateways `ParamPos` (bank key `param-pos`) and `Param3DHostPos` (bank key `param-3d-host-pos`). Complete
compile-checked code:
[`examples/param-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/param-3d-secure.ts).

Status: unit-tested; the request and callback hashes are differential-tested against PHP built-ins.

## Account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createParamPosAccount(
  'param-pos', // key of `banks` in the config ('param-3d-host-pos' for the hosted page)
  clientCode, // CLIENT_CODE
  apiUser, // CLIENT_USERNAME
  apiPassword, // CLIENT_PASSWORD
  guid, // the merchant GUID: signs requests and callbacks
  terminalId, // only needed for the hosted page (Param3DHostPos)
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created. The GUID and the API password
are masked in logs and error text.

## ParamPos

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | The bank shows the card check; its callback is followed by one provision request from your server. |
| 3D Pay | `MODEL.THREE_D_PAY` | The browser is sent to the bank's page, which charges the card and posts the result. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server sale, no 3D step. |

Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) works with 3D Secure and non-secure; `TX_TYPE.PAY_POST_AUTH` closes it. A 3D
pre-authorization is Turkish lira only. Other operations: `status`, `cancel`, `refund` and partial refund. Cancelling a
sale needs `amount` on the order; pass `transaction_type: 'pre'` to cancel a pre-authorization. There is no
`orderHistory`, and the hosted page is `Param3DHostPos` (`make3DHostPayment` throws `UnsupportedPaymentModelError`).
Sales in USD, EUR or GBP use the bank's foreign-currency flow, which returns a payment result callback like 3D Pay.

## 3D flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) and tie it to the customer's session. The order also
   needs `ip` (the payer's address), `success_url` and `fail_url`.
2. `pos.get3DFormData(order, model, TX_TYPE.PAY_AUTH, card)` registers the payment with the bank from your server (one
   request, the card travels there) and returns what the browser needs:
   - 3D Secure in Turkish lira: **an HTML page built by the bank. Send it to the browser as it is.**
   - 3D Pay and foreign-currency payments: `{ gateway, method: 'GET', inputs }`, a redirect form to the bank's page.

   Nothing later needs the card, so never store it.
3. The customer pays; the bank sends the browser to your `success_url` or `fail_url`.
4. Load the order from the customer's session and call
   `pos.payment(MODEL.THREE_D_SECURE | MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, callbackBody)`.

```ts
const page = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card) // HTML for the browser
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

## Callback handling

- **Why every approval is confirmed with the bank.** Param's payment result callback carries the merchant GUID it is
  signed with, so anyone who has seen one of your callbacks can sign another. The signature alone proves nothing; the
  bank's own status record is the proof. Expect **one extra status request** for every approved payment: the record
  must show this order, the receipt number the callback reported, the amount, the transaction type, the installment
  count, a successful and unrefunded payment. Treat the GUID like a credential: it does not authorize API requests by
  itself (those also need the API user and password), but ask Param to rotate it if a callback body ever reaches logs
  or analytics, and never log callback bodies.
- **The signature is always verified.** A wrong one throws `HashMismatchError`, and an approval must carry one. The
  signed fields are checked for their exact formats. A callback must be a flat form of strings.
- **3D Secure.** The signed order id and, when sent, the amount must be your order's before anything is sent. The
  provision is built from your order and sent only when the 3D result is a success; its answer must name your order and
  is then confirmed with the status request. An approved provision after a failed 3D check is returned as `declined`
  with `requires_manual_review: true`.
- **Mismatches.** `OrderMismatchError` means the callback, the provision answer or the bank's record does not belong to
  your order. `paymentMayHaveCompleted: true` is set only when the bank's own answer shows a payment: alert, check
  `pos.status(order)`, then cancel or refund. Without it the bank shows no matching payment. `error.response` carries
  the attached result.
- **Declines** carry your order id and the bank's reason only; never use a callback's echoed order id to look up an
  order. The echoed GUID is removed from every returned result.
- **Unknown outcomes.** An empty or unreadable answer after a money request, a provision answer with a result code but
  no receipt, or a failed status request after a charge throws `PosHttpError`. Keep the order pending, re-check with
  `pos.status(order)` and never retry blindly.
- **Complete each order once.** Mark it paid in an idempotent update.

## Order ids, amounts and hooks

- An order id is 1 to 64 letters, digits, `_` or `-`, starting with a letter or digit. Use ids of one fixed length
  (zero-padded or UUID-based): the signed values have no separators.
- Amounts go to the bank as `1000,25` for payments and `1000.25` for cancel and refund, rounded like PHP
  `number_format`.
- A hook that changes a signed field of a registration (amount, order id, URLs, installment or account) invalidates its
  `Islem_Hash`, and the bank rejects it.

## Param3DHostPos: the hosted page

The bank's own collection page takes the card, so the card never touches your server. It sells only (3D Host);
everything else is `ParamPos`.

```ts
const account = AccountFactory.createParamPosAccount('param-3d-host-pos', clientCode, apiUser, apiPassword, guid, terminalId)
const pos = PosFactory.createPosGateway(account, posTestConfig)

const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH) // { gateway, method: 'GET', inputs: { s } }
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

- **The order is bound by a derived id.** The registration carries no order id and the bank assigns its own. The library
  derives the transaction id of the request from your order id, amount and currency with a key stretched from the API
  password, and checks it in the bank's record. Use a strong API password, reuse the account object (the first
  derivation per account takes a moment), and keep the same `id`, `amount` and `currency` between the form and the
  callback.
- **Every approval is confirmed** with one status request to the TurkPos service (`query_api` in the config); your Param
  account must be able to query hosted-page payments there. A payment alert (`paymentMayHaveCompleted`, manual review)
  is raised only for a bank record that carries evidence of this order, and a record of another payment raises none.
  The callback's order id only names the record to look up.
- Status, cancel and refund of hosted payments go through a `ParamPos` gateway built with the `param-pos` entry and the
  same credentials. The rules for unknown outcomes above apply as well.

## Queries

`ParamPosQuery` offers custom queries, `history`, `getInstallmentRates` and `getBinList`, see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md).
