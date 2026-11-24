# typescript-pos

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
