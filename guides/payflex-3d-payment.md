# PayFlex V4 3D Secure (VakıfBank, Ziraat PayFlex)

Gateway `PayFlexV4Pos`. Complete compile-checked code: [`examples/payflex-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/payflex-3d-secure.ts).

Status: unit-tested. Verified live against the VakıfBank public TEST environment (port 8443) on 2026-11-23:
3D enrollment (Status `Y`), non-3D Sale (`0000`) and Cancel (`0000`). Test it with your own merchant before going live.

## PCI scope

PayFlex 3D Secure (MPI) needs the card number on your server for the enrollment request and again for the provision.
That puts you under **PCI DSS SAQ D**. Never log, store or persist card data; keep it in memory (or a short-lived,
encrypted server-side store) only between enrollment and callback. If this is a problem, use a model that keeps card
data off your server (for example Asseco 3D Pay Hosting) or a bank-hosted common payment page.

## Configuration

```ts
import { AccountFactory, PayFlexPosAccount, PosFactory, posProductionConfig } from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount(
  'vakifbank',
  merchantId,
  password,
  terminalNo,
  PayFlexPosAccount.MERCHANT_TYPE_STANDARD, // 0 standard, 1 main dealer, 2 sub dealer (needs subMerchantId)
)
const bank = posProductionConfig.banks.vakifbank
// Opt-in: set require_3d_hash only when your bank signs the callback with `Hash` (see below).
const requireHash = process.env.PAYFLEX_REQUIRE_HASH === '1'
const pos = PosFactory.createPosGateway(account, { banks: { vakifbank: { ...bank, require_3d_hash: requireHash } } })
```

- **MerchantType must match your contract.** The public test merchant is a main dealer (`MERCHANT_TYPE_MAIN_DEALER`,
  1). A type that does not match your contract makes the bank reject requests. For sub dealers pass `subMerchantId` as the sixth argument.
- **Network requirements (VakıfBank).** Your server IP must be whitelisted by the bank. `success_url` / `fail_url`
  must be public HTTPS URLs and must not contain `localhost` (the WAF rejects them).
- **Test config.** `posTestConfig` has `vakifbank` and `ziraat-vpos`. Use `vakifbank` as bank
  name in test; to keep a different name use `{ banks: { myname: posTestConfig.banks.vakifbank } }`.
- **`require_3d_hash` (default `false`).** When your bank sends a `Hash` field in the callback, enable it: a callback
  without `Hash` is then rejected (`HashMismatchError`). Without it, and without a `Hash` in the callback, the
  order-binding guard compares values supplied by the browser, which only stops naive replays. A present `Hash` is
  always verified.

## Flow

1. Persist the order (`id`, `amount`, `currency`) on your server. `ip` (customer IP), `success_url` and `fail_url`
   are required.
2. `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)` sends the enrollment request. It returns
   `{ gateway, method: 'POST', inputs: { PaReq, TermUrl, MD } }` only when enrollment Status is `Y`; otherwise it throws
   `PosError` (N: not enrolled, U: cannot process, E: error with `cause.code`). Render an auto-submitting form to the
   customer's browser.
3. After the customer authenticates, the ACS posts to `success_url` / `fail_url`. Load the order by id on your server
   and call `pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, body)`. PayFlex needs the card again.
4. Check `response.status`. Keep `response.transaction_id` for `pos.cancel({ transaction_id, ip })` and refunds.

## Strict 3D rule

A 3D result is accepted only when `Status=Y` **and** ECI is `02` or `05` **and** CAVV is present **and** `MdStatus` is
`1` when present. Half-secure (attempted) authentications are declined without a provision request. ECI `5` without
the leading zero is rejected too (fails closed); it must be `05`.

Before the provision request the callback `PurchAmount`, `PurchCurrency` and `MerchantId` must match your order and
account, otherwise `OrderMismatchError` (`field` is `amount`, `currency` or `merchant_id`). Sub-dealer accounts also
accept the sub-dealer number as `MerchantId`. `PurchAmount` is read from the signed digits with two implied decimals.

## Callback handling

- The bank/ACS POSTs cross-site, so session cookies (`SameSite`) may be missing. Identify the order by the id you put
  in the `success_url` / `fail_url` query string (for example `?o=<orderId>`; use an unguessable token), then load the
  order from your database.
- Always pass the body through `pos.payment(...)`. Do not trust `Status`, `Eci`, `Cavv` or `PurchAmount` directly.
- Treat `HashMismatchError` and `OrderMismatchError` as failures. Do not provision the payment yourself. Both are
  raised before the provision request, so no money has moved (`error.paymentMayHaveCompleted` is `false`).
- **Outcome unknown.** `pos.payment(...)` sends the provision request from your server. A `PosHttpError` (timeout,
  non-2xx, HTML/WAF page) there, or after a non-3D payment, post-authorization, cancel or refund, does not mean the
  bank did nothing: it may have processed the request before the connection failed. Never retry a payment blindly,
  since that can charge the customer twice. Call `pos.status(order)` first and retry only when the bank has no record
  of the transaction.

```ts
try {
  const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, body)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError || error instanceof OrderMismatchError) return false
  // PosHttpError etc.: outcome unknown. Never retry blindly; check pos.status(order) first.
  throw error
}
```

## Good to know

- Amounts are major units (`10.5`). Installments use the `installment` order key.
- **Istanbul calendar day.** Dates the library formats for the bank (recurring `RecurringEndDate` / `TriggerDate`)
  use the calendar day in Europe/Istanbul, not your server's time zone. A `Date` close to midnight can therefore map to
  the previous or next day, for example `2026-03-01T22:30:00Z` is already 2 March in Istanbul, and a midnight in a
  far-east time zone (UTC+09:00) is still the previous day in Istanbul. Build such dates at Istanbul noon if you mean
  a specific day.
- **`ClientIp` on cancel and refund.** `pos.cancel()` and `pos.refund()` send `ClientIp` empty when the order has no
  `ip`; whether VakıfBank requires it there is not verified. Pass `order.ip` (your server's or the customer's IP).
  Payments and post-authorization require `ip` and throw `PosError` without it.
- **`MdStatus: ''` counts as absent.** An empty `MdStatus` in the callback is treated like a missing one, so the
  strict 3D rule then relies on `Status`, `Eci` and `Cavv`.
- **Status with several records.** When the `Search` answer of `pos.status()` contains more than one transaction for
  the order, the response is mapped as `declined` with empty transaction fields. Use your own records (stored
  `transaction_id`, amounts) or the bank panel to reconcile such orders.
- `make3DPayPayment`, `make3DHostPayment` and `orderHistory` are not supported by PayFlex V4 and throw.
- Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00).
- Bank HTML/WAF pages and non-2xx answers raise `PosHttpError` with a masked snippet instead of a parser crash.
