# typescript-pos

## 0.14.0

### Minor Changes

- Payment, status, cancel, refund and order-history results of every gateway now always carry `order_id`, `proc_return_code`, `error_code`, `error_message` and `all` (null when the bank sends none).
- 50ebe27: Breaking: with `createWithoutCard: true` a card passed to `get3DFormData` is no longer put into the 3D form (Asseco, Garanti, Akbank, Albaraka POSNET, PayFor in both form formats, InterPos, PayTR; Tosla already did this); the payer enters the card on the bank page. Pass `createWithoutCard: false` when you want the library to put the card into the form.
  
  Breaking: order ids must be 1-64 letters, digits, `_` or `-`, starting with a letter or digit (Yapı Kredi and Albaraka POSNET: 1-20; VakıfBank Common Payment: no `_`), and a number is accepted only as a safe non-negative integer; any other id now throws `PosError` before a request is sent when a payment starts (3D form, non-secure sale, pre-authorization) on every gateway (Asseco, Garanti, Akbank and PayFlex V4 accepted any value before; PayFor, InterPos, POSNET and VakıfBank Common Payment accepted a leading `_` or `-`). Orders created earlier keep working: their callbacks, 3D provisions, captures, cancels, refunds, status and history requests accept any existing id of text (up to 64 characters, POSNET 20) without control characters, or a safe non-negative integer.
  
  Breaking: `IyzicoPos.make3DPayPayment` now rejects with `UnsupportedPaymentModelError` (was `UnsupportedTransactionTypeError`), like every other gateway's payment-model method; `payment()` with the 3D Pay model still throws `UnsupportedTransactionTypeError`.
- 7519150: Add render3DFormHtml to turn get3DFormData results into an escaped auto-submit page (for redirects, iframes and popups).
- 0d6d646: Breaking: a payment, pre-/post-authorization, 3D provision or refund whose bank answer is empty or carries no result code now rejects with PosHttpError (outcome unknown) instead of returning a declined response, for every gateway; check status() before retrying. Asseco 3D Secure callbacks must now match the order id, amount and currency before the provision.
  
  Breaking: custom response mappers implementing `ResponseDataMapperInterface` must add `readProcReturnCode(raw): string | null`, the bank's result code of a raw answer, or `null` when the answer carries none.

### Patch Changes

- 4cc049d: Amounts that round up to 1e13 (`9999999999999.996`) are refused like 1e13 itself, on every gateway; iyzico answer amounts of 1e13 or more leave the field `null`.
  
  `OrderMismatchError` messages now start with `Order <field> mismatch` (they said `Callback`), since the order is also compared with data the bank returned from a query.
  
  Order ids of 3D callbacks (Asseco, Yapı Kredi and Albaraka POSNET, VakıfBank Common Payment) and Akbank recurring track ids are read as existing order ids before they are compared or sent; an array, object, unsafe number or text with a control character is a `PosError` instead of the text it prints as.
  
  A card passed with a hosted payment model is never written into the browser form, with or without `createWithoutCard`: `3d_host` refuses a card (`PosError`); `3d_pay_hosting` drops it.
  
  POSNET `ref_ret_num` and `auth_code` must be non-blank strings, a Garanti history page must be an integer from 1 to 9999 and a BIN 6 to 8 digits, an Akbank history `batch_num` a positive integer; anything else is a `PosError`. Akbank custom queries no longer format the request time when the caller supplies one.
  
  VakıfBank Common Payment status requests refuse a `transaction_id` or `payment_token` that is not a string instead of dropping it, and its answer's `TransactionId`, `MaskedPan` and `Rrn` are text or `null`. Garanti answer fields that are objects or arrays are `null` instead of `"[object Object]"`. A custom query without any allowed origin says so in its error.
- 918ff51: Add operation guides (payment models, after-payment cancel/refund/status/history, pre-authorization and capture), a guide index, and security definitions for `requires_manual_review`, `paymentMayHaveCompleted`, unknown outcomes, card-free forms and order ids.
  
  Add examples for the hosted Param page, operations after a payment (cancel, refund, status) and pre-authorization with capture.
  
  Update both READMEs: link the guide index and the new guides, summarise the library-wide rules (card-free forms, order ids, unknown outcomes, result keys), mention `render3DFormHtml`, list every test configuration key and add an upgrade note for 0.14.
- 6e25d04: Credentials a request carries in its body (`Password`, `MerchantPassword`, `UserPass` on the Asseco, PayFlex V4, VakıfBank Common Payment, PayFor and InterPos clients, and the `HashPassword` signing value on the Vakıf Katılım client, as the Param, PayTR and iyzico clients already did) are hidden from thrown errors and every log line, also when a failing bank page echoes them in free text, URL-encoded (an echoed form body), cut at the 500-character snippet edge or in an ISO-8859-9 page; the "parsing bank response failed" log line shows the answer decoded with its own charset.
  
  Log masking of JSON text now covers every sensitive key (`StoreKey`, `SecretKey`, `store_key`, `terminalId`, `cardNumber` …) with string or number values, also inside a JSON text that was itself put into a JSON string (`{\"cvv\":\"123\"}`); a card number under such a key is now hidden whole instead of as its first six and last four digits. A masked `Error` keeps its masked `cause`, and `maskSensitiveData(error)` is typed as a plain record.
  
  Bank answers above 10 MiB are refused with `PosHttpError('Bank answer is too large')` without reading or keeping the body (`HttpTransport` option `maxResponseBytes`); after a money request this is an unknown outcome like any other transport error.
  
  VakıfBank Common Payment: a payment token that contradicts the order is logged by length only, and the `OrderMismatchError` describes the tokens (`expected: 'the payment token of this order'`, `actual: 'another payment token'`) instead of carrying them; a refused non-https payment URL is logged by scheme and host only.

## 0.13.0

### Minor Changes

- 31ff49b: Add the IyzicoPos gateway (iyzico) with IyzicoPosAccount: 3D Secure, 3D Host (checkout form) and non-secure payments and pre-authorizations, post-authorization, cancel, refund and partial refund, status and order history; every request is signed (IYZWSv2), iyzico's callback and answer signatures are verified and every payment approval (sale, authorization, capture, checkout record) is bound to the order's basket id, amount, currency and phase, refunds are signed and bound to the payment id and amount, cancel answers are unsigned and checked only for the conversation id and payment id when present, fraud reviews are flagged for manual review and unknown outcomes after money-moving requests are reported as errors; add IyzicoPosQuery with custom queries, history, installment prices and BIN lookups; add GET requests to the HTTP layer; mask iyzico authorization headers and card fields in logs.

## 0.12.0

### Minor Changes

- fb515ff: Add the PayTrPos gateway (PayTR) with PayTrPosAccount: iFrame (3D Host), Direct API 3D Pay (also without card data on your server) and non-secure payments, status, refund and partial refund; payment results are taken only from the signed server-to-server notification and bound to the order's id and amount, browser returns never approve, unknown outcomes after money-moving requests are reported as errors; add PayTrPosQuery with custom queries, history, installment rates and BIN lookups; mask PayTR tokens and card fields in logs.

## 0.11.0

### Minor Changes

- e898704: Add the ParamPos and Param3DHostPos gateways (Param) with ParamPosAccount: verified 3D callbacks bound to the order, 3D Secure provisions and every 3D approval confirmed with the bank's status record, hosted-page payments bound to the order through a derived transaction id, unknown outcomes after money-moving requests reported as errors, and ParamPosQuery with custom queries, history, installment rates and BIN lists; add shared SOAP helpers and mask Param credentials in logs.
  
  KuveytPos now refuses SOAP answers that define a document type or entities.

## 0.10.0

### Minor Changes

- e85b584: Add the ToslaPos gateway (Tosla) with ToslaPosAccount: verified 3D Pay and 3D Host callbacks bound to the order and confirmed with the bank's record, exact kuruş amounts, and ToslaPosQuery with custom queries and the first installment rate and installment price queries; add CARD_FAMILY constants; mask request hashes in logs.

## 0.9.0

### Minor Changes

- 88a0b99: Add the KuveytPos (Kuveyt Türk) and VakifKatilimPos (Vakıf Katılım) gateways with BoaPosAccount: verified 3D callbacks, provisions built from and bound to the order, bank-confirmed Vakıf Katılım 3D Host payments, exact kuruş amounts and VakifKatilimPosQuery custom and history queries.

## 0.8.0

### Minor Changes

- d969375: Add the InterPos gateway for Denizbank (3D Secure, 3D Pay, 3D Host, non-secure, pre/post auth, status, cancel, refund) with callbacks verified over a fixed field list for every model, bank-confirmed 3D Pay / 3D Host results and InterPosQuery custom queries.

## 0.7.0

### Minor Changes

- 5e17c71: Add the PayForPos gateway for QNB Finansbank and Ziraat Katılım (3D Secure, 3D Pay, 3D Host, non-secure, pre/post auth, status, cancel, refund, order history) with verified callbacks, bank-confirmed 3D results and PayForPosQuery custom queries and history. `history()` results may now carry `status: null` when the bank's answer has no overall result (PayFor day reports).

## 0.6.0

### Minor Changes

- 00b8688: Add the PosNetPos (Yapı Kredi) and PosNetV1Pos (Albaraka Türk) gateways (3D Secure, non-secure, pre/post auth, status, cancel, refund; PosNetV1Pos refuses partial refunds of 3D orders, which its lookup cannot carry an amount for) with bank-verified 3D results bound to the order, exact kuruş amounts, and PosNetPosQuery/PosNetV1PosQuery custom queries.

## 0.5.0

### Minor Changes

- 9303957: Add the AkbankPos gateway (Akbank virtual POS API: 3D Secure, 3D Pay, 3D Host, non-secure, pre/post auth, cancel, refund, order history, recurring) with signed requests, callback hash and order checks and bank-confirmed 3D Pay/Host results, and AkbankPosQuery with custom queries and transaction history.

## 0.4.0

### Minor Changes

- 83fec35: Add the GarantiPos gateway (Garanti BBVA: 3D Secure, 3D Pay, non-secure, pre/post auth, status, cancel, refund, order history) with callback hash and order checks, and GarantiPosQuery with custom queries, transaction history and BIN list.

## 0.3.0

### Minor Changes

- 10943c0: Add a stateless query layer (PosQueryFactory) with custom queries for AssecoPos, PayFlexV4Pos and PayFlexCPV4Pos, an onPosQueryRequestDataPrepared hook, and an https origin check for custom query URLs.

## 0.2.0

### Minor Changes

- acab172: Add PayFlexCPV4Pos for the VakıfBank Common Payment hosted page (3D Pay / 3D Host sale and pre-auth, server-side result confirmation, status query).

### Patch Changes

- 29503cd: Mask JSON-encoded secrets and ExpireMonth/ExpireYear fields in logs and HTTP error snippets.

## 0.1.1

### Patch Changes

- Documentation: the npm page now shows the English README (the Turkish README is renamed to `README-tr.md` and is no longer shipped in the package), and pending live-verification notes are removed from the READMEs and guides. No API or behaviour change.

## 0.1.0

### Minor Changes

- Initial release: a TypeScript library for Turkish bank virtual POS (sanal POS) gateways, for Node.js 22 or newer, ESM and CommonJS, with two runtime dependencies (`fast-xml-parser`, `iconv-lite`).
  
  - **Core.** Stateless, async gateway API (`payment`, `get3DFormData`, `cancel`, `refund`, `status`, `orderHistory`) with snake_case order and response keys, typed constants (`MODEL`, `TX_TYPE`, `CURRENCY`, ...), account and card models, hooks, and a `PosError` hierarchy (`HashMismatchError`, `OrderMismatchError`, `PosHttpError`, `MissingAccountInfoError`, `InvalidCardError`, ...).
  - **AssecoPos (NestPay/Payten).** İş Bankası, Akbank, Halkbank, TEB, Şekerbank, QNB Finansbank and Ziraat (Asseco): 3D Secure, 3D Pay, 3D Pay Hosting, 3D Host and non-3D payments, pre/post-authorization, cancel, refund, status and order history, with the hash differential-tested against PHP.
  - **PayFlexV4Pos.** VakıfBank on the 8443 API gateway and Ziraat PayFlex: 3D Secure (MPI) and non-3D payments, post-authorization, cancel, refund and status.
  - **PosFactory and configs.** `PosFactory.createPosGateway()` wires a gateway from a bank config; `posProductionConfig` and `posTestConfig` are deeply frozen with typed bank keys; the HTTP transport is injectable with a 60 second default timeout.
  - **Security.** 3D hash verification cannot be disabled and is compared in constant time; Asseco callbacks are bound to the order id, amount and payment model (`OrderMismatchError`, with `paymentMayHaveCompleted` when the bank approved); PayFlex applies a strict 3D rule and binds callbacks to amount, currency and merchant, with an opt-in `require_3d_hash`; authorized-but-3D-failed answers are flagged `requires_manual_review`; card data, passwords and keys are masked before logging; only `https:` endpoints are accepted and redirects are never followed.
