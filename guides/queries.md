# Queries (custom bank requests)

Complete compile-checked code:
[`examples/custom-query.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/custom-query.ts).

## What a query object is

A gateway (`PosFactory.createPosGateway`) handles payments and the operations of one order. A query object handles
requests that are not tied to one order. Create it with the same account and config as the gateway:

```ts
import { AccountFactory, PosQueryFactory, posProductionConfig } from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', merchantId, password, terminalNo)
const query = PosQueryFactory.createPosQuery(account, posProductionConfig, { logger, hooks })
```

`options` is the same object `PosFactory` takes (`logger`, `hooks`, `testMode`, `fetch`, `timeoutMs`, `transport`),
plus `allowedApiOrigins` (see below). The object is stateless: every method returns its own promise, there is no
`getResponse()`, and one instance can serve concurrent calls.

## `history` and `orderHistory`

`gateway.orderHistory(order)` reports one order. `query.history(data)` lists transactions without an order. Neither
replaces the other.

## What the shipped gateways support

| Query class | `custom_query` | `history` | `installment_rates` | `installment_prices` | `bin_list` |
|---|---|---|---|---|---|
| `AssecoPosQuery` | yes | no | no | no | no |
| `PayFlexV4PosQuery` | yes | no | no | no | no |
| `PayFlexCPV4PosQuery` | yes | no | no | no | no |
| `GarantiPosQuery` | yes | yes | no | no | yes |
| `AkbankPosQuery` | yes | yes | no | no | no |
| `PosNetPosQuery` | yes | no | no | no | no |
| `PosNetV1PosQuery` | yes | no | no | no | no |
| `PayForPosQuery` | yes | yes | no | no | no |
| `InterPosQuery` | yes | no | no | no | no |
| `VakifKatilimPosQuery` | yes | yes | no | no | no |
| `ToslaPosQuery` | yes | no | yes | yes | no |
| `ParamPosQuery` | yes | yes | yes | no | yes |

A query the bank class does not offer rejects with `UnsupportedTransactionTypeError`; it never throws synchronously.
Check first when the choice is dynamic:

```ts
import { AssecoPosQuery, QUERY_TYPE } from 'typescript-pos'

AssecoPosQuery.isSupportedQuery(QUERY_TYPE.HISTORY) // false
```

## `customQuery(requestData, apiUrl?)`

You send the fields of the bank's own request. The query adds the credentials you left out and keeps every value you
did pass (a credential you set yourself is never overwritten). The answer is decoded but **not normalized**: you get
the bank's field names back.

| Gateway | Credentials added | Wire format | Default target |
|---|---|---|---|
| `AssecoPos` | `Name`, `Password`, `ClientId` | `CC5Request` XML (ISO-8859-9) | `payment_api` |
| `PayFlexV4Pos` | `MerchantId`, `Password`, `TerminalNo` | `VposRequest` XML in the `prmstr` form field | `payment_api` |
| `PayFlexCPV4Pos` | `HostMerchantId`, `MerchantId`, `Password` | JSON | `payment_api` + `/GetVposTransaction` |
| `GarantiPos` | `Mode`, `Version`, `Terminal` and `Terminal.HashData` (each only when missing) | `GVPSRequest` XML | `payment_api` |
| `AkbankPos` | `terminal`, `version`, `requestDateTime`, `randomNumber` (each only when missing) | JSON, signed with the `auth-hash` header | `payment_api` + `/transaction/process` unless `apiUrl` is given |
| `PosNetPos` | `mid`, `tid` (each only when missing) | XML in the `xmldata` form field | `payment_api` unless `apiUrl` is given |
| `PayForPos` | `MerchantId`, `UserCode`, `UserPass`, `MbrId` (each only when missing) | `PayforRequest` XML | `payment_api` unless `apiUrl` is given |
| `InterPos` | `UserCode`, `UserPass`, `ShopCode` (each only when missing) | form-urlencoded; the answer is decoded from the bank's `key=value;;` text | `payment_api` unless `apiUrl` is given |
| `VakifKatilimPos` | none: the data goes out unchanged, so send a complete signed request | the gateway's XML | none: `apiUrl` is required |
| `ToslaPos` | `clientId`, `apiUser`, `rnd`, `timeSpan` (each only when missing) and the `hash` over them (when you set no `hash`) | JSON | none: `apiUrl` is required |
| `ParamPos` | `G` (`CLIENT_CODE`, `CLIENT_USERNAME`, `CLIENT_PASSWORD`) and `GUID` (each only when missing) | SOAP: one action with its fields | `payment_api` unless `apiUrl` is given |
| `PosNetV1Pos` | `ApiType`, `ApiVersion`, `MerchantNo`, `TerminalNo` (each only when missing) and a `MAC` over the fields listed in `MACParams` (when you set no `MAC`) | JSON | none: `apiUrl` is required |

For a sub-dealer account `MerchantId` is the sub-merchant id, otherwise `'1'`.

```ts
// VakıfBank Common Payment: one transaction
const answer = await cpQuery.customQuery({ TransactionId: '0123456789abcdef0123456789abcdef' })

// Asseco: a card query (test card number only)
const card = await assecoQuery.customQuery({
  Type: 'Query',
  Number: '4242424242424242',
  Expires: '12.2030',
  Extra: { IMECECARDQUERY: null },
})
```

The optional second argument targets another URL, see the next section.

## Garanti: `history` and `getBinList`

```ts
const query = PosQueryFactory.createPosQuery(garantiAccount, posProductionConfig)

// Transactions of a date range (at most 30 days apart)
const list = await query.history({ ip: '203.0.113.10', start_date: new Date('2026-11-01T00:00:00+03:00'), end_date: new Date('2026-11-15T00:00:00+03:00') })
// list.status, list.trans_count, list.transactions[]: order_id, ref_ret_num, auth_code, proc_return_code, order_status,
// transaction_type, payment_model, currency, first_amount, masked_number, transaction_time, ...

// BIN records, optionally filtered
const bins = await query.getBinList({ ip: '203.0.113.10', bin: '424242', card_class: CARD_CLASS.CREDIT })
// bins.status, bins.bin_list[]: bin, bank_code, bank_name, card_type, card_class
```

A declined answer has `status: 'declined'`, an empty list and the bank's message in `error_message`. The raw decoded
answer is always in `all`.

## Akbank: `history`

```ts
const query = PosQueryFactory.createPosQuery(akbankAccount, posProductionConfig)

// By batch number, or by a date range of at most one day (Türkiye time)
const byBatch = await query.history({ batch_num: 12 })
const byDate = await query.history({ start_date: new Date('2026-11-14T00:00:00+03:00'), end_date: new Date('2026-11-14T23:59:59+03:00') })
// byDate.status, byDate.trans_count, byDate.transactions[]: order_id, ref_ret_num, auth_code, order_status,
// transaction_type, currency, installment_count, first_amount, masked_number, batch_num, transaction_time, ...
```

A declined answer has `status: 'declined'`, an empty list and the bank's message in `error_message`. The raw decoded
answer is always in `all`. See the [Akbank guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/akbank-pos-payment.md).

## PayFor: `history`

```ts
const query = PosQueryFactory.createPosQuery(payForAccount, posProductionConfig)

// The transactions of one day (a Date; Türkiye time)
const day = await query.history({ transaction_date: new Date('2026-11-14T00:00:00+03:00') })
// day.status is null when the bank's answer carries no overall result; day.transactions[] lists the day's records
```

A single order is listed by the gateway's `orderHistory({ id })`. The raw decoded answer is always in `all`. See the
[PayFor guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/payfor-payment.md).

## Vakıf Katılım: `history`

```ts
const query = PosQueryFactory.createPosQuery(vakifKatilimAccount, posProductionConfig)

// The orders of a date range, paged
const list = await query.history({
  start_date: new Date('2026-11-14T00:00:00+03:00'),
  end_date: new Date('2026-11-14T23:59:59+03:00'),
  page: 1,
  page_size: 100,
})
```

A custom query for this gateway is sent exactly as given and needs an `apiUrl` on the bank's origin, because the gateway
has one path per query. Kuveyt Türk (`KuveytPos`) has no query service. The raw decoded answer is always in `all`.

## Tosla: installment rates and prices

```ts
const query = PosQueryFactory.createPosQuery(toslaAccount, posProductionConfig)

// Commission table of a card: `bin` is the first six digits of the card number
const rates = await query.getInstallmentRates({ bin: '454671' })
// rates.status, rates.error_message, rates.installment_rates[]: bank_code, bank_name, card_prefix, card_type, card_class,
// card_family, rates[]: { installment, rate, constant }

// Installment options of an amount in TL
const prices = await query.getInstallmentPrices({ amount: 100.5 })
// prices.installment_prices[0].prices[]: { installment, installment_price, total_price }
```

| Field | Meaning |
|---|---|
| `installment` | The installment count. For rates it is 2 or more (the single payment is not listed). |
| `rate` | The bank's commission percentage for that count. |
| `constant` | The bank's fixed fee for that count. |
| `installment_price` | One installment's price in the major unit of the order currency (TL), rounded half up to a whole kuruş. |
| `total_price` | The total of all installments in TL. |

`bin` must be six digits and `amount` a valid order amount (both are checked before anything is signed or sent). The
bank answers prices in kuruş; the library converts them to TL. Entries of the bank's answer that are malformed (an
unusable count, rate or amount) are dropped and logged, never returned as guesses. A declined answer has
`status: 'declined'`, an empty list and the bank's message in `error_message`; the raw decoded answer is always in `all`.
`card_family` values are in the `CARD_FAMILY` constants where a bank reports one.

Tosla has no `history` or `getBinList`: the gateway's `orderHistory` lists the records of one order. Its custom query
is sent with the account fields and the signature added; because the signature covers `clientId`, `apiUser`, `rnd` and
`timeSpan`, a hook that edits one of them invalidates it. The query needs an `apiUrl` on the API origin.

## Param: history, installment rates and BIN list

```ts
const query = PosQueryFactory.createPosQuery(paramAccount, posProductionConfig)

// Records of a window (Date values, Türkiye time); order_status (text) and transaction_type are optional filters
const list = await query.history({
  start_date: new Date('2026-11-14T00:00:00+03:00'),
  end_date: new Date('2026-11-14T23:59:59+03:00'),
  order_status: 'Başarılı',
  transaction_type: 'pay', // 'pay' | 'cancel' | 'refund'
})
// list.status, list.trans_count, list.transactions[] (newest first): order_id, transaction_type, payment_model, currency,
// first_amount, refund_amount, transaction_time, proc_return_code, error_message, ...

// The merchant's special rates, one group per card program (no parameters)
const rates = await query.getInstallmentRates({})
// rates.installment_rates[]: card_family, rates[]: { installment (2 to 12), rate, constant: 0 }

// The cards of a BIN (6 or 8 digits); without `bin` the whole table is returned
const bins = await query.getBinList({ bin: '424242' })
// bins.bin_list[]: bin, bank_code, bank_name, card_type, card_class
```

A custom query names one SOAP action of the TurkPos service and its fields, for example
`{ SomeAction: { Field: 'value' } }`; the account's client code, API user, API password and merchant key are added to
the fields you leave out, and the action's URL is the configured `payment_api` unless you pass an allowed `apiUrl`. An
answer that echoes one of the credentials is returned with `***` in its place. Param has no installment prices.
History only reports records: it never confirms a payment, use `pos.status(order)` for that. A declined answer has
`status: 'declined'`, an empty list and the bank's message in `error_message`; the raw decoded answer is always in `all`.
See the [Param guide](https://github.com/mkiyak/typescript-pos/blob/main/guides/param-payment.md).

## Custom URLs are restricted

The credentials go into the request body, so a URL that arrives from request input, configuration drift or a typo
would send them to a foreign host. `apiUrl` is accepted only when it:

- parses as a URL with the `https:` scheme,
- has no user name or password in it, and
- has the same origin (scheme, host and port) as one of the endpoints in the bank's config, or as an entry of
  `allowedApiOrigins`.

Anything else makes the `customQuery` promise reject with a `PosError` before a request is built or sent. A path on a configured bank
host works as is. Add other bank hosts explicitly (each entry must be an `https:` URL, checked when the object is
created):

```ts
const query = PosQueryFactory.createPosQuery(account, posProductionConfig, {
  allowedApiOrigins: ['https://apipos.vakifbank.com.tr:8443'],
})
await query.customQuery({ /* … */ }, 'https://apipos.vakifbank.com.tr:8443/some/path')
```

## Hook `onPosQueryRequestDataPrepared`

It runs after the credentials are added and before the request is sent. The event has:

| Field | Meaning |
|---|---|
| `requestData` | The prepared request. Mutate it in place or assign a new object to it; it is a copy, so your caller's object is untouched. |
| `bankName` | The bank key, e.g. `vakifbank-cp`. |
| `queryType` | A `QUERY_TYPE` value, e.g. `custom_query`. |
| `gatewayClass` | The gateway the query serves, e.g. `PayFlexCPV4Pos`. |
| `originalData` | What you passed in. Frozen at the top level only (nested objects stay mutable, so do not change them). |

```ts
const query = PosQueryFactory.createPosQuery(account, posProductionConfig, {
  hooks: {
    onPosQueryRequestDataPrepared: [
      (event) => {
        if (event.queryType === 'custom_query') {
          event.requestData.Reference = 'audit-42'
        }
      },
    ],
  },
})
```

When a hook changes the data, the change is written to the debug log with sensitive values masked.

## Logging

Query logs are masked like the gateway logs: card numbers, passwords and keys never appear. A decoded answer of a custom
query is returned to you and is not logged. An HTTP error body or a body that cannot be decoded is logged, masked and
truncated.
