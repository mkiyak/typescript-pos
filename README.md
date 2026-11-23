# typescript-pos

[![CI](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/typescript-pos.svg)](https://www.npmjs.com/package/typescript-pos)
[![license](https://img.shields.io/github/license/mkiyak/typescript-pos.svg)](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

A single, stateless, async TypeScript interface to Turkish bank virtual POS (sanal POS) gateways, including 3D Secure flows. Node.js 20 or newer,
ESM and CommonJS, two runtime dependencies (`fast-xml-parser`, `iconv-lite`).

> Status: v0.1, pre-1.0. Minor versions may contain breaking changes (see [Versioning](#versioning)).

## Supported gateways

| Gateway        | Banks                                                                                         | Verification                                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssecoPos`    | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, QNB Finansbank (Asseco) | Unit-tested; the 3D hash is differential-tested against PHP (0 mismatches in 1000 random sets). Not yet run against a live bank environment.                                                                                                      |
| `PayFlexV4Pos` | VakıfBank (port 8443), Ziraat (PayFlex)                                                       | Unit-tested. VakıfBank public TEST environment, verified live on 2026-11-23: 3D enrollment (Status `Y`), non-3D Sale (`0000`) and Cancel (`0000`). The full browser 3D completion (ACS, callback, provision) and the real callback `PurchAmount` format are **not yet verified live**. |

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
- [Security and production checklist](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)

Other operations: `pos.cancel(order)`, `pos.refund(order)` (partial when `order.order_amount` is set and
`order.amount` is lower), `pos.status(order)`, `pos.orderHistory(order)` (Asseco only), `pos.payment(MODEL.NON_SECURE, ...)`
for payments without 3D Secure, and `TX_TYPE.PAY_PRE_AUTH` / `TX_TYPE.PAY_POST_AUTH` for pre- and post-authorization.

### Test vs production configuration

`posProductionConfig` is keyed by bank (`isbank`, `akbank`, `vakifbank`, ...). `posTestConfig` is keyed by
vendor: `asseco`, `vakifbank`, `ziraat-vpos`. An İşbank test account therefore uses the bank name
`asseco`, or keep one name in your code with the spread pattern:

```ts
import { posTestConfig } from 'typescript-pos'

const testConfig = { banks: { isbank: posTestConfig.banks.asseco! } }
```

## Callback handling

The bank sends the customer back with a cross-site POST, so `SameSite` session cookies may be missing. Look the
order up by id on the server, always pass the callback through the gateway method (`pos.payment(...)`,
`make3DPayment`, ...) and never trust callback fields directly. `OrderMismatchError` can occur on any Asseco
3D Pay / 3D Host callback, including declined ones: treat it as a failure and read `error.response`
(`transaction_id`, `proc_return_code`, `requires_manual_review`). When `requires_manual_review` is `true`, money may
have moved: investigate and void or refund. Details in the guides.

Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00).

## Design

1. Stateless, async API: each network method returns its own response; no `isSuccess()` / `getResponse()` state.
2. Order and normalized response keys are snake_case and the same for every gateway.
3. No option disables 3D hash verification. `AssecoPos` always requires a valid hash; `PayFlexV4Pos` verifies a `Hash` whenever the callback carries one and rejects a missing one only with `require_3d_hash: true`.
4. Sensitive data (PAN, CVV, expiry, passwords, store keys) is masked before it reaches the logger.
5. Constant-time hash comparison; the Asseco hash uses the exact natural, case-insensitive key ordering the bank expects.
6. Extra Asseco safeguards: returned order id and amount are compared with the order (`OrderMismatchError`);
   an authorized-but-3D-failed response is declined and flagged `requires_manual_review`.
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

Türkçe: [README.tr.md](https://github.com/mkiyak/typescript-pos/blob/main/README.tr.md)
