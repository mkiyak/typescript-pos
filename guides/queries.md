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
