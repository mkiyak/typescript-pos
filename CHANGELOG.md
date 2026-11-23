# typescript-pos

## 0.1.0

### Minor Changes

- Initial release: a TypeScript library for Turkish bank virtual POS (sanal POS) gateways, for Node.js 22 or newer, ESM and CommonJS, with two runtime dependencies (`fast-xml-parser`, `iconv-lite`).
  
  - **Core.** Stateless, async gateway API (`payment`, `get3DFormData`, `cancel`, `refund`, `status`, `orderHistory`) with snake_case order and response keys, typed constants (`MODEL`, `TX_TYPE`, `CURRENCY`, ...), account and card models, hooks, and a `PosError` hierarchy (`HashMismatchError`, `OrderMismatchError`, `PosHttpError`, `MissingAccountInfoError`, `InvalidCardError`, ...).
  - **AssecoPos (NestPay/Payten).** İş Bankası, Akbank, Halkbank, TEB, Şekerbank, QNB Finansbank and Ziraat (Asseco): 3D Secure, 3D Pay, 3D Pay Hosting, 3D Host and non-3D payments, pre/post-authorization, cancel, refund, status and order history, with the hash differential-tested against PHP.
  - **PayFlexV4Pos.** VakıfBank on the 8443 API gateway and Ziraat PayFlex: 3D Secure (MPI) and non-3D payments, post-authorization, cancel, refund and status.
  - **PosFactory and configs.** `PosFactory.createPosGateway()` wires a gateway from a bank config; `posProductionConfig` and `posTestConfig` are deeply frozen with typed bank keys; the HTTP transport is injectable with a 60 second default timeout.
  - **Security.** 3D hash verification cannot be disabled and is compared in constant time; Asseco callbacks are bound to the order id, amount and payment model (`OrderMismatchError`, with `paymentMayHaveCompleted` when the bank approved); PayFlex applies a strict 3D rule and binds callbacks to amount, currency and merchant, with an opt-in `require_3d_hash`; authorized-but-3D-failed answers are flagged `requires_manual_review`; card data, passwords and keys are masked before logging; only `https:` endpoints are accepted and redirects are never followed.
