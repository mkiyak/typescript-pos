# typescript-pos

[![CI](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/typescript-pos.svg)](https://www.npmjs.com/package/typescript-pos)
[![license](https://img.shields.io/github/license/mkiyak/typescript-pos.svg)](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

A single, stateless, async TypeScript interface to Turkish bank virtual POS (sanal POS) gateways, including 3D Secure flows. Node.js 22 or newer,
ESM and CommonJS, two runtime dependencies (`fast-xml-parser`, `iconv-lite`).

> Status: v0.1, pre-1.0. Minor versions may contain breaking changes (see [Versioning](#versioning)).

## Supported gateways

| Gateway        | Banks                                                                                         | Verification                                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssecoPos`    | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, QNB Finansbank (Asseco) | Unit-tested; the 3D hash is differential-tested against PHP (0 mismatches in 1000 random sets).                                                                                                      |
| `PayFlexV4Pos` | VakıfBank (port 8443), Ziraat (PayFlex)                                                       | Unit-tested. VakıfBank public TEST environment, verified live on 2026-11-23: 3D enrollment (Status `Y`), non-3D Sale (`0000`) and Cancel (`0000`). |
| `PayFlexCPV4Pos` | VakıfBank (Common Payment hosted page, port 8443) | Unit-tested. |
| `GarantiPos` | Garanti BBVA | Unit-tested; hashes and amount format differential-tested against PHP. |
| `AkbankPos` | Akbank (virtual POS API) | Unit-tested; request signature, 3D hashes and amount format differential-tested against PHP (0 mismatches in 1000 random sets each). |
| `PosNetPos` | Yapı Kredi (POSNET XML) | Unit-tested; MACs, amount and order-id formats differential-tested against PHP (0 mismatches in 1000 random sets each). |
| `PosNetV1Pos` | Albaraka Türk (POSNET JSON) | Unit-tested; MACs differential-tested against PHP (0 mismatches in 1000 random sets each). |
| `PayForPos` | QNB Finansbank (PayFor), Ziraat Katılım (PayFor) | Unit-tested; form and callback hashes and the amount format differential-tested against PHP (0 mismatches in 2,000 random sets each). |
| `InterPos` | Denizbank (InterVPOS) | Unit-tested; form and callback hashes and the amount format differential-tested against PHP (0 mismatches in 2,000 random sets each). |
| `KuveytPos` | Kuveyt Türk | Unit-tested; request and callback hashes and the kuruş amount conversion differential-tested against PHP (0 mismatches in 1,000 random sets each). |
| `VakifKatilimPos` | Vakıf Katılım | Unit-tested; request and callback hashes and the kuruş amount conversion differential-tested against PHP (0 mismatches in 1,000 random sets each). |
| `ToslaPos` | Tosla | Unit-tested; request and callback hashes differential-tested against PHP (0 mismatches in 1,000 random sets each). |
| `ParamPos` | Param (TURK Elektronik Para) | Unit-tested; request and callback hashes differential-tested against PHP (0 mismatches in 1,000 random sets each). |
| `Param3DHostPos` | Param hosted payment page | Unit-tested; callback hashes differential-tested against PHP (0 mismatches in 1,000 random sets); the transaction id against PHP's PBKDF2/HMAC (0 mismatches in 1,000 sets). |

## Install

```sh
npm install typescript-pos
```

## Quick start

Everything is built with plain objects. Order keys and normalized response keys are snake_case
(`id`, `amount`, `success_url`, ... and `status`, `proc_return_code`, `order_id`, ...). Amounts are in
major units (`10.5` is 10,50 TL).

### Asseco 3D Pay Hosting (card data stays off your server)

```ts
import { AccountFactory, MODEL, PosFactory, posProductionConfig, TX_TYPE } from 'typescript-pos'

const account = AccountFactory.createAssecoPosAccount('isbank', clientId, username, password, storeKey)
const pos = PosFactory.createPosGateway(account, posProductionConfig) // stateless, share it

// 1. Build the form your page auto-submits to the bank.
const form = await pos.get3DFormData(order, MODEL.THREE_D_PAY_HOSTING, TX_TYPE.PAY_AUTH)
// { gateway, method: 'POST', inputs }

// 2. The bank POSTs the customer back to success_url / fail_url.
const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, callbackBody)
if (response.status === 'approved') {
  /* paid */
}
```

### PayFlex 3D Secure (card data passes through your server, PCI SAQ D)

```ts
import { AccountFactory, CARD_TYPE, CreditCardFactory, MODEL, PosFactory, posProductionConfig, TX_TYPE } from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount('vakifbank', merchantId, password, terminalNo)
const pos = PosFactory.createPosGateway(account, posProductionConfig)
const card = CreditCardFactory.create('4938410157705591', '29', '12', '453', 'John Doe', CARD_TYPE.VISA)

// 1. Enrollment: returns the ACS form (throws when the card is not enrolled).
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)

// 2. Callback: verifies the result and sends the provision request. PayFlex needs the card again.
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, callbackBody)
```

Complete, compile-checked versions with error handling live in [`examples/`](https://github.com/mkiyak/typescript-pos/tree/main/examples). Step-by-step guides:

- [Asseco 3D Pay Hosting](https://github.com/mkiyak/typescript-pos/blob/main/guides/asseco-3d-payment.md)
- [PayFlex V4 3D Secure](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-3d-payment.md)
- [VakıfBank Common Payment (3D Host / 3D Pay)](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-cp-payment.md)
- [Garanti BBVA 3D payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/garanti-3d-payment.md)
- [Akbank virtual POS payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/akbank-pos-payment.md)
- [Yapı Kredi POSNET 3D payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/posnet-3d-payment.md)
- [Albaraka Türk POSNET 3D payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/posnet-v1-3d-payment.md)
- [QNB Finansbank and Ziraat Katılım (PayFor) payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/payfor-payment.md)
- [Denizbank (InterVPOS) payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/interpos-payment.md)
- [Kuveyt Türk payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/kuveytpos-payment.md)
- [Vakıf Katılım payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/vakif-katilim-payment.md)
- [Tosla payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/tosla-payment.md)
- [Param payment](https://github.com/mkiyak/typescript-pos/blob/main/guides/param-payment.md)
- [Queries (custom bank requests)](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)
- [Security and production checklist](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)

Other operations: `pos.cancel(order)`, `pos.refund(order)` (partial when `order.order_amount` is set and
`order.amount` is lower), `pos.status(order)`, `pos.orderHistory(order)` (Asseco, Garanti, Akbank, PayFor, Vakıf Katılım and Tosla), `pos.payment(MODEL.NON_SECURE, ...)`
for payments without 3D Secure, and `TX_TYPE.PAY_PRE_AUTH` / `TX_TYPE.PAY_POST_AUTH` for pre- and post-authorization.

### Test vs production configuration

`posProductionConfig` is keyed by bank (`isbank`, `akbank`, `vakifbank`, ...). `posTestConfig` is keyed by
vendor: `asseco`, `vakifbank`, `ziraat-vpos`. An İşbank test account therefore uses the bank name
`asseco`, or keep one name in your code with the spread pattern:

```ts
import { posTestConfig } from 'typescript-pos'

const testConfig = { banks: { isbank: posTestConfig.banks.asseco } }
```

Both shipped configs are deeply frozen and their bank keys are typed. To change an entry, spread it into a new object:
`{ ...posProductionConfig.banks.vakifbank, require_3d_hash: true }`.

## Callback handling

The bank sends the customer back with a cross-site POST, so `SameSite` session cookies may be missing. Look the
order up by id on the server, always pass the callback through the gateway method (`pos.payment(...)`,
`make3DPayment`, ...) and never trust callback fields directly. `OrderMismatchError` can occur on any Asseco
3D Pay / 3D Host callback, including declined ones (`error.field` is `order_id`, `amount` or `storetype`), and on a
3D Secure callback whose `storetype` does not match the payment model: treat it
as a failure for the order and read `error.response` (`transaction_id`, `proc_return_code`). When
`error.paymentMayHaveCompleted` is `true` the bank reported a completed payment for that callback, so the card may
have been charged: alert someone and void or refund it. A declined response with `requires_manual_review: true`
(authorized by the bank although 3D verification failed) may also mean money moved: investigate. Details in the
guides.

```ts
try {
  const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)
  if (response.requires_manual_review) alertOps(response)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError) return false
  if (error instanceof OrderMismatchError) {
    if (error.paymentMayHaveCompleted) alertOps(error.response) // void or refund it
    return false
  }
  throw error // outcome unknown: check pos.status(order) before any retry
}
```

**Outcome unknown: never retry payments blindly.** A `PosHttpError` (timeout, non-2xx, HTML/WAF page) after a
request that moves money (PayFlex 3D Secure or Asseco `MODEL.THREE_D_SECURE` provisioning, non-3D payments,
post-authorization, cancel, refund) may arrive after the bank has already processed it. Retrying can charge the
customer twice. Call `pos.status(order)` first and retry only when the bank has no record of the transaction.

Every error the library throws extends `PosError` (for example `HashMismatchError`, `OrderMismatchError`,
`MissingAccountInfoError`, `InvalidCardError`, `PosHttpError`).

Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00). Dates sent to the bank (PayFlex
recurring dates) use the Istanbul calendar day, so a `Date` near midnight in another time zone can map to the
previous or next day.

PayFlex notes (details in the [PayFlex guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-3d-payment.md#good-to-know)):
cancel and refund send `ClientIp` empty without `order.ip` (pass it); an empty `MdStatus` counts as absent; a status
`Search` answer with several records is mapped as `declined` with empty fields, so reconcile those from your own
records.

## Queries

Requests that are not tied to one order go through a stateless query object. Create it like a gateway; credentials are added for you.

```ts
import { PosQueryFactory } from 'typescript-pos'

const query = PosQueryFactory.createPosQuery(account, posProductionConfig)
const answer = await query.customQuery({ TransactionId: transactionId }) // decoded, not normalized
```

Custom URLs must be `https:` on a configured bank origin (or one you list in `allowedApiOrigins`). `GarantiPos` also supports `history` and `getBinList`, `AkbankPos`, `PayForPos` and `VakifKatilimPos` support `history` (Vakıf Katılım's custom queries need an `apiUrl`; Kuveyt Türk offers no queries). `ToslaPos` offers custom queries (with an `apiUrl`), `getInstallmentRates` (by 6-digit bin) and `getInstallmentPrices` (by amount in TL), the first installment queries. `ParamPos` offers custom queries, `history`, `getInstallmentRates` and `getBinList`. For Asseco, PayFlex V4, VakıfBank Common Payment, InterPos and the POSNET gateways only `customQuery` is offered; the other queries reject
with `UnsupportedTransactionTypeError`. See the [queries guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md).

## Design

1. Stateless, async API: each network method returns its own response; no `isSuccess()` / `getResponse()` state.
2. Order and normalized response keys are snake_case and the same for every gateway.
3. No option disables 3D hash verification. `AssecoPos` always requires a valid hash; `GarantiPos` always verifies a signed callback and accepts an unsigned one only as a decline (`require_3d_hash: true` rejects it too); `AkbankPos` always requires a valid hash for 3D Pay, 3D Host and successful 3D Secure callbacks, and confirms approved 3D Pay/Host results with the bank; `PayFlexV4Pos` verifies a `Hash` whenever the callback carries one and rejects a missing one only with `require_3d_hash: true`; `PosNetPos` always verifies the bank's MAC on the decrypted 3D result; `PosNetV1Pos` always requires a valid MAC on successful callbacks (an unsigned declined one is rejected only with `require_3d_hash: true`); `PayForPos` always verifies a signed callback, and confirms every approved 3D result with the bank before returning it (a Ziraat Katılım callback without a signature never approves a payment by itself); `InterPos` always verifies a signed callback over a fixed field list, accepts an unsigned one only as a decline, and confirms every approved 3D Pay / 3D Host result with the bank before returning it; `KuveytPos` always verifies the bank's `HashData`, builds the provision from your order and binds the bank's answer to it; `VakifKatilimPos` does the same for 3D Secure and confirms every approved 3D Host payment with the bank (the 3D Host form carries the hashed API password); `ToslaPos` always verifies a signed callback over a fixed field list, accepts an unsigned one only as a decline, and confirms every approved 3D Pay / 3D Host result with the bank's own record (the callback signs neither amount nor currency); `ParamPos` and `Param3DHostPos` confirm every approved payment with the bank's status record, because Param's callbacks carry the merchant GUID they are signed with, and bind hosted payments to the order through a derived transaction id.
4. Sensitive data (PAN, CVV, expiry, passwords, store keys) is masked before it reaches the logger.
5. Constant-time hash comparison; the Asseco hash uses the exact natural, case-insensitive key ordering the bank expects.
6. Extra Asseco, Garanti and Akbank safeguards: the returned order id, amount and payment model (Garanti: also terminal and currency) are compared with the order
   (`OrderMismatchError`, with `paymentMayHaveCompleted` when the bank approved); for Akbank the callback's order id and
   merchant/terminal are checked directly, and the amount, currency, transaction type, installment count and order status are
   confirmed through the bank's order history; an authorized-but-3D-failed
   response is declined and flagged `requires_manual_review`.
7. Extra PayFlex safeguards: strict 3D rule (Status `Y`, ECI `02`/`05`, CAVV, `MdStatus` 1 when present), callback
   amount, currency and merchant binding, optional `require_3d_hash`.
8. VakıfBank default endpoints use port 8443; `MerchantType` is configurable per account.
9. Hooks (`onRequestDataPrepared`, `onBefore3DFormHashCalculated`) to inspect or change outgoing data.
10. Thin `fetch`-based HTTP layer (injectable, 60 s default timeout); bank HTML/WAF pages raise `PosHttpError`.

## Security

Read [SECURITY.md](https://github.com/mkiyak/typescript-pos/blob/main/SECURITY.md) to report vulnerabilities and [guides/security.md](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md) for a
production checklist. PCI DSS: PayFlex 3D Secure (MPI) needs card data on your server, so you fall under SAQ D;
Asseco 3D Pay Hosting keeps card data off your server.

## Versioning

[SemVer](https://semver.org). Before 1.0, a breaking change bumps the minor version and everything else bumps the
patch version. Commits follow [Conventional Commits](https://www.conventionalcommits.org); releases are managed
with [Changesets](https://github.com/changesets/changesets) (see [CONTRIBUTING.md](https://github.com/mkiyak/typescript-pos/blob/main/CONTRIBUTING.md)).

## License

[MIT](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

Türkçe: [README-tr.md](https://github.com/mkiyak/typescript-pos/blob/main/README-tr.md)
