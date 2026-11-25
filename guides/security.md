# Security and production checklist

Report vulnerabilities privately: see [SECURITY.md](https://github.com/mkiyak/typescript-pos/blob/main/SECURITY.md).


## What the library does for you

- **Hash verification.** Comparison is constant time, and no option disables it. [How each gateway verifies its
  callbacks](#how-each-gateway-verifies-callbacks) is listed below.
- **Order binding.** The order id, amount, currency, merchant and payment model a callback or a bank record carries are
  compared with your order; a difference throws `OrderMismatchError`. Prefer fixed-length order ids (zero-padded or
  UUID-based): they leave no ambiguity about where the order id ends in a signed callback. See also
  [Order ids](#order-ids).
- **Manual-review flag and `paymentMayHaveCompleted`.** [When money may have moved](#when-money-may-have-moved)
  defines both exactly.
- **Unknown outcomes.** An unclear answer after a request that moves money throws `PosHttpError` instead of mapping
  to `declined`: [Outcome unknown](#outcome-unknown).
- **Masking.** Everything handed to your logger, error snippets and `OrderMismatchError.response.all` goes through
  `maskSensitiveData()` (PAN, CVV, expiry, passwords, store keys). Request credentials are also hidden from thrown
  errors and logs on every gateway.
- **HTTPS only.** `PosFactory` rejects bank endpoints that are not `https:` URLs, and HTTP redirects are never
  followed (a 307/308 would resend card data and credentials to another host); both raise `PosError`/`PosHttpError`.
- **No network on import**, two runtime dependencies, global `fetch`.

## How each gateway verifies callbacks

No option disables 3D hash verification. A hash that is present is always verified, and the callback is bound to your
order.

- **Asseco (`AssecoPos`).** Hash verification cannot be turned off; a valid hash is always required, and a missing,
  empty or non-string `HASH` raises `HashMismatchError`. The callback is also bound to your order
  (`OrderMismatchError`): 3D Pay and 3D Host callbacks must carry your order id and amount and the `storetype` of the
  payment model they are completed with. A 3D Secure callback is bound before the provision: the signed `oid` is
  required and must be your order id, and `amount` and the currency, when the callback carries them, must equal the
  order's. Those checks run before the hook and before any request, so nothing has been charged and no response is
  attached.
- **PayFlex V4 (`PayFlexV4Pos`).** A `Hash` that is present is always verified (`HashMismatchError` on mismatch). A callback
  without `Hash` is rejected only with `require_3d_hash: true`; otherwise (and for declined callbacks, which are
  mapped without a provision request) the defence is the strict 3D rule (Status `Y`, ECI `02`/`05`, CAVV, `MdStatus` 1),
  the amount, currency and merchant binding (`OrderMismatchError`, nothing charged) and the bank's own CAVV /
  MpiTransactionId checks at provision time.
- **Garanti.** The callback signature cannot be disabled and signed callbacks must carry the bank's fixed field list;
  an approved payment is never accepted from an unsigned callback (`require_3d_hash: true` also rejects unsigned
  declines), and the callback's terminal id and order id must equal your account and order (`OrderMismatchError`).
- **Akbank (`AkbankPos`).** Every request is signed with the secret key and every callback is verified; 3D Pay and
  3D Host callbacks and successful 3D Secure callbacks must be signed, and an approved result is confirmed with the bank (one signed order-history request)
  before it is returned. When the bank does not confirm it, `OrderMismatchError.paymentMayHaveCompleted` is `true`.
- **PayFor (`PayForPos`).** The signed callback is verified with pinned fields and can never be switched off; the
  echoed order id, amount, currency, transaction type, installment count and model are bound to your order
  (`OrderMismatchError`), and every approved 3D result is confirmed with a status request before it is returned. A
  Ziraat Katılım callback without a signature never approves a payment by itself.
- **InterPos (`InterPos`).** The callback is verified over the bank's fixed field list for every model and can never be
  switched off; the signed order id, amount and currency are bound to your order (`OrderMismatchError`), and every
  approved 3D Pay / 3D Host result is confirmed with a status request before it is returned. An unsigned callback can
  only become a decline.
- **Kuveyt Türk (`KuveytPos`).** The callback's `HashData` is always verified and an approval must carry it; the signed
  order id must be your order's, the provision is built from your order (never from the callback) and the bank's
  answer must name your order, amount and currency (`OrderMismatchError`, with `paymentMayHaveCompleted`). An empty or
  unclear answer after a provision or sale throws instead of being read as a decline: keep the order pending and
  check `pos.status`.
- **Vakıf Katılım (`VakifKatilimPos`).** The same for 3D Secure. Every approved 3D Host payment is confirmed with one
  status request, because the 3D Host form carries the hashed API password. With your merchant number, customer
  number and user name, whoever loaded the form can sign callbacks and also cancel, refund and status requests through
  the bank's API. Restrict the API at the bank to your own server IP addresses, and re-query `pos.status` before
  acting on a 3D Host alert, which may be forged.
- **Tosla (`ToslaPos`).** The callback's `Hash` is verified over a fixed field list and an approval must carry it
  (`require_3d_hash: true` also rejects unsigned declines). Only the order id, 3D status, response code and message and
  request status are signed, so the signed order id must be your order's and every approved 3D Pay / 3D Host result is
  confirmed with the bank's own record (amount, currency, installment count) before it is returned
  (`OrderMismatchError`, with `paymentMayHaveCompleted`). Request hashes do not cover the body, so they are masked in
  logs. An empty or unclear answer after a sale or post-authorization throws: keep the order pending and check
  `pos.status`.
- **Param (`ParamPos`, `Param3DHostPos`).** Param's callbacks carry the merchant GUID they are signed with, so a valid
  signature proves nothing on its own: every approval is confirmed with the bank's status record, 3D Secure
  provisions are built from your order after the order id and amount are checked, and hosted-page payments are bound
  to the order through a transaction id derived from it (use a strong API password). The GUID and API password are
  masked in logs and the echoed GUID is removed from returned callback data. An empty or unreadable answer after a
  money request throws: keep the order pending and check `pos.status` (for a hosted payment, on a `ParamPos` gateway built from the `param-pos` entry, with the bank's order id `TURKPOS_RETVAL_Siparis_ID` as `id`, never your own order id). Rotate the GUID with Param if a callback body
  leaks into logs.
- **PayTR (`PayTrPos`).** A payment result comes only from the signed server-to-server notification, whose hash is
  always verified and whose order id and total amount must match your order (`OrderMismatchError`, with
  `paymentMayHaveCompleted` when the payer was charged another amount). Browser returns never approve. The 3D Pay
  form's signature lets the payer move characters between fields and change the amount; the notification check reports
  it, and 3D Host does not have the gap. PayTR reports one final status, so there is no approved-but-3D-failed case; a charged mismatch carries
  `requires_manual_review` in `error.response`. A test-mode notification never approves a live order. An unclear answer after
  a sale or refund throws: keep the order pending and check `pos.status`. `paytr_token`, the salt, the key and card
  fields are masked in logs.
- **iyzico (`IyzicoPos`).** Every request carries an authorization header signed from the exact bytes sent; the header
  and the secret key are masked in logs. A 3D Secure callback signature and every payment answer signature are verified,
  and each approval is bound to the order's basket id, conversation id, payment id, amount, currency and phase
  (`OrderMismatchError`, with `paymentMayHaveCompleted` when money moved). 3D Host results come only from iyzico's
  signed checkout record of the callback token, so a forged token cannot approve. Refunds are signed and bound to the
  payment id and amount, while cancel answers are unsigned and only the conversation id and payment id are checked when
  present. An approval that cannot be verified,
  or any unclear answer after a money request, is an error (`PosHttpError`): keep the order pending and check
  `pos.status` or `pos.orderHistory`. Fraud reviews and failed 3D checks on completed payments come back `declined` with
  `requires_manual_review`: do not ship. Handle callbacks idempotently and never downgrade a paid order on a later
  decline.
- **POSNET (`PosNetPos`).** The 3D result is decrypted by the bank and its MAC is verified before any money moves;
  the bank-resolved order id, amount, currency and installment count must equal your order's (`OrderMismatchError`,
  nothing charged). The check cannot be disabled.
- **POSNET (`PosNetV1Pos`).** The callback signature cannot be disabled; the signed fields are pinned to the
  bank's formats, the echoed order id, amount, currency, merchant and transaction type are compared with your order
  (`OrderMismatchError`), and the provision always charges your order's own amount.

## When money may have moved

Two signals tell you that a bank may have taken money that your order is not waiting for. Both come only from data the
library could verify: a signed callback, the bank's answer to a request your server sent, or the bank's own record. A
callback that could not be verified (no signature, wrong signature) never raises either of them: it throws
`HashMismatchError`, or, where a gateway accepts unsigned callbacks, it maps to a plain `declined` result that carries no
callback values besides bounded decline reasons.

### `requires_manual_review: true`

A **declined** `PosResponse` with this key means the bank authorized or holds money, but the library cannot report the
payment as a success. The usual cause is a payment the bank approved although the 3D authentication did not succeed;
some gateways also set it when the callback claimed a success that the bank's own record does not confirm.

What to do: do not ship the goods, do not retry the payment, alert someone, and reconcile with the bank panel and with
`pos.status(order)` (`pos.orderHistory(order)` on `AkbankPos`). If the card was charged, cancel or refund it. Do not treat the result as a
plain failure and do not release stock automatically.

### `OrderMismatchError.paymentMayHaveCompleted`

`OrderMismatchError` says that verified data does not belong to the order you passed (`error.field` names the value:
`order_id`, `amount`, `currency`, `merchant_id`, `storetype`, `transaction_id`, `transaction_type`, `terminal_id`,
`payment_model`, `order_status`, `installment` or `test_mode`). `paymentMayHaveCompleted` is `true` when the same
evidence shows an approved payment (`status` `approved`, `proc_return_code` `00`, or a review flag). Then:

- `error.response` holds the mapped result, with `requires_manual_review: true` and a masked `all`;
- the money may have moved for another order, another amount or another store of yours;
- do **not** mark your order paid; alert someone, find the payment with `error.response.transaction_id` or the bank
  panel, and cancel or refund it unless it is genuinely yours.

`paymentMayHaveCompleted: false` means the verified data shows no approved payment, or the check ran before any request
that could move money. Treat it as a failed attempt: you probably loaded the wrong order, or the callback was forged
or replayed.

### What each gateway sets

| Gateway | `requires_manual_review` | `paymentMayHaveCompleted` is `true` |
|---|---|---|
| `AssecoPos` | The bank authorized (`ProcReturnCode` `00`) but 3D verification (`mdStatus`) failed | A correctly signed 3D Pay or 3D Host callback reports a completed payment for another order id, amount or payment model. 3D Secure callbacks are bound before the provision: no payment, `false` |
| `PayFlexV4Pos` | Never | Never: the checks run before the provision request |
| `PayFlexCPV4Pos` | The callback says the payment succeeded but the bank's transaction query does not confirm it | The bank's query record of an approved payment does not match your order. A callback naming another transaction id or payment token is refused before any request (`false`) |
| `GarantiPos` | The bank authorized but 3D failed (3D Pay) | A signed 3D Pay answer reports a completed payment that is not your order's. 3D Secure checks run before the provision (`false`) |
| `AkbankPos` | The bank authorized but 3D failed (3D Pay, 3D Host) | The bank's order-history record does not confirm an approved 3D Pay or 3D Host callback (`order_status`, `installment`, amount and so on) |
| `PosNetPos`, `PosNetV1Pos` | Not in the normal flow: a failed 3D result is never provisioned | Never: the bank-decrypted or MAC-verified result is bound before anything is charged, and no response is attached |
| `PayForPos` | Only where the bank's own status record shows the payment | The confirmation request of an approved 3D result does not match your order |
| `InterPos` | Only where the bank's own status record shows the payment (an unsigned callback never sets it) | The confirmation request of an approved 3D Pay or 3D Host result does not match your order; a 3D Pay result posted to a 3D Secure order only when the bank's record shows the payment |
| `KuveytPos` | On the result attached to an `OrderMismatchError` | The bank's answer to the provision names another order, amount or currency |
| `VakifKatilimPos` | On the result attached to an `OrderMismatchError`; a 3D Host alert can be provoked by a forger, so re-query `status` first | The provision answer (3D Secure) or the status confirmation (3D Host) does not match your order |
| `ToslaPos` | Only where one status request shows that the bank holds a payment for the order | The status record of an approved 3D Pay or 3D Host result does not match your order |
| `ParamPos`, `Param3DHostPos` | 3D Secure: a provision answer naming another order, or a bank record that does not match after a provision. 3D Pay and 3D Host: only a bank record that shows the payment (3D Host also a record of this order at another amount or currency) | Only when the bank's own answer shows a payment |
| `PayTrPos` | Never from the browser returns; the signed notification of a charged payer at another amount or currency throws with the flag on `error.response` | The signed notification proves the payer was charged for this order at another amount or currency |
| `IyzicoPos` | iyzico holds the payment for fraud review, or a 3D check failed on a payment that went through | A signed answer for another order, amount, currency or phase shows money moved |

An **unsigned callback never raises either signal on its own**: where a gateway accepts one at all, it can only become a
decline (or be rejected with `HashMismatchError`). `KuveytPos` and `VakifKatilimPos` never flag an unsigned decline;
`InterPos`, `ToslaPos`, `ParamPos` and `PayForPos` flag one only when the bank's own record shows the payment.

Handle both in one place and keep the alert idempotent:

```ts
try {
  const response = await pos.payment(model, order, TX_TYPE.PAY_AUTH, null, callbackBody)
  if (response.requires_manual_review) await alertOps(order.id, response)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof OrderMismatchError && error.paymentMayHaveCompleted) await alertOps(order.id, error.response)
  throw error
}
```

## Outcome unknown

A request that moves money can fail after the bank processed it: a timeout, a non-2xx answer, an HTML or WAF page, an
empty body. The library never reads such an answer as a decline, because that invites a retry and a double charge.

It throws `PosHttpError` when the answer carries **no result** (an empty body or `{}`, no result code, an unreadable
page) after:

- a non-secure payment or pre-authorization;
- a post-authorization (capture);
- the provision request of a 3D Secure payment (`AssecoPos`, `GarantiPos`, `AkbankPos`, `PayFlexV4Pos`, `PosNetPos`,
  `PosNetV1Pos`, `InterPos`, `PayForPos`, `KuveytPos`, `VakifKatilimPos`, `ParamPos`, `IyzicoPos`);
- a refund (`KuveytPos` and `VakifKatilimPos` included: an answer without a response code is not read as `declined`).

A failed confirmation request (on the gateways that confirm approvals with the bank's own record) propagates as
`PosHttpError` too: the payment may have completed.

A cancel, `status`, `orderHistory`, a query or the form initialisation does not move money twice, so a repeated cancel
is harmless: most gateways still map an empty cancel answer to `declined`, a few (iyzico, for example) throw as for a
refund.

What to do:

1. Keep the order `pending`. Do not mark it failed, do not cancel stock, do not retry.
2. Ask the bank: `pos.status(order)`; `pos.orderHistory(order)` for `AkbankPos` (no status request) and for iyzico
   cancels and refunds. A hosted payment is re-checked with the stored id (`PayFlexCPV4Pos`:
   `pos.status({ transaction_id })`; hosted Param: a `ParamPos` gateway with the bank's order id).
3. Retry only when the bank shows no sign of the request. A retried payment charges twice and a retried refund may
   refund twice (PayTR: match `all.returns` by `reference_no`).
4. Never put automatic retries around these calls: not in HTTP middleware, job queues or a client library.

```ts
try {
  return await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card)
} catch (error) {
  if (error instanceof PosHttpError) return markPendingAndReconcile(order) // never an automatic retry
  throw error
}
```

## Building forms without the card

`createWithoutCard: true` (the fifth argument of `get3DFormData`) tells the library that the payer's browser
collects the card. The library then **never writes a card into the form**: a card you pass anyway is dropped (it is not
used, not logged). That holds for every gateway that renders a card form: `AssecoPos`, `GarantiPos`, `AkbankPos`,
`PosNetV1Pos`, `PayForPos` (array and `formFormat: 'html'`), `InterPos`, `PayTrPos` and `ToslaPos`. For the hosted
models (`3d_host`, `3d_pay_hosting`) a passed card is dropped even without the flag, because the bank page asks for it.

Where the card never reaches a browser form, the flag has no effect: `KuveytPos`, `VakifKatilimPos` (3D Secure),
`ParamPos`, `IyzicoPos` (3D Secure), `PosNetPos`, `PayFlexV4Pos` and `PayFlexCPV4Pos` send the card from your server
to the bank, or hold none. In those flows your server sees the card (SAQ D).

When the form is card-free, the payer enters the card on the bank page or into card fields of your page that post
straight to the bank (PayTR and Tosla). Your page's code then decides where the card goes: serve it with a strict CSP,
no third-party scripts, and no analytics on the card fields. If you pass a card instead, the returned `inputs` hold it:
render them once, with `Cache-Control: no-store`, and never log, cache or store them.

## Order ids

One rule applies to the order id on every gateway that sends it to the bank: **1 to 64 letters, digits, `_` or `-`,
starting with a letter or digit.** A number is accepted only as a safe non-negative integer (it is converted with
`String`). Anything else throws `PosError` before a request is sent.

Exceptions: the POSNET gateways accept at most 20 characters (the library pads them with zeros), and VakıfBank Common
Payment does not accept `_`. Asseco instalment suffixes (`202210121ABC-2`) stay valid.

The reason is security as much as the bank format: banks sign callbacks by concatenating fields without separators,
and ids are posted unescaped in form bodies. A leading separator, a blank, `&`, `%` or a non-ASCII letter never reaches
a bank. Use ids of one fixed length: one id must never be another id plus extra characters.

## Rendering the 3D form

Hand-written auto-submit pages are where escaping bugs and open redirects hide. Use `render3DFormHtml(form, options)`
for form objects: it escapes every name and value, refuses non-`https:` actions, and carries your CSP nonce.

Serve the page from a route of your own with `Cache-Control: no-store` and a CSP (`script-src 'nonce-…'`,
`frame-ancestors 'self'`); point a redirect, iframe or popup at that route instead of `srcdoc` or `document.write`.
Bank HTML strings (`KuveytPos`, `VakifKatilimPos` 3D Secure, `PayForPos` with `formFormat: 'html'`, `IyzicoPos`) are not
yours: serve them as they are on such a route and never insert them into your page.

In an iframe or popup, the page tells its opener only "done for order X" with `postMessage(message, <your own origin>)`
(never `'*'`), and the opener asks your server for the order's state: a message is never proof of payment. Full details:
[3D pages in a redirect, an iframe or a popup](./3d-iframe-and-popup.md).

## What you must do

1. **Callbacks.** Look the order up by id on the server; the bank POSTs cross-site so session cookies may be missing.
   Always call the gateway method for the callback and never trust callback fields directly. Exempt the callback route
   from CSRF protection (Asseco: the hash authenticates it; PayFlex: the hash when present, plus the checks above) but
   nothing else.
2. **Persist before redirecting.** Store the order (`id`, `amount`, `currency`) before the customer leaves, and mark
   it paid only from the gateway response, in an idempotent update (callbacks can be replayed or arrive twice).
3. **Manual review.** Handle `requires_manual_review` and `OrderMismatchError.paymentMayHaveCompleted` with
   `OrderMismatchError.response` as [defined above](#when-money-may-have-moved): alert, reconcile with the bank panel
   or `pos.status()`, void or refund.
4. **PayFlex: enable `require_3d_hash`** as soon as your bank sends a `Hash` field in the callback. Until then the
   order binding compares browser-supplied values.
5. **Network.** VakıfBank requires server IP whitelisting and public HTTPS callback URLs without `localhost`. Use
   HTTPS everywhere; never expose the store key, merchant password or terminal id to the browser.
6. **Secrets.** Keep merchant credentials in environment variables or a secret manager, not in the repository.
7. **Logging.** Pass your logger via `createPosGateway(..., { logger })`. Do not log request or callback bodies
   yourself: they contain card data and keys.
8. **Outcome unknown: never retry payments blindly.** See [Outcome unknown](#outcome-unknown): keep the order pending,
   call `pos.status(order)`, and never wrap payment calls in automatic retries.
9. **Timezones.** Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00), independent of the
   server timezone.
10. **Keep dependencies current** and watch the changelog: before 1.0 minor versions may break.

## PCI DSS

Your scope follows the model (see [payment models](./payment-models.md)):

| Where the card goes | Models | Typical scope |
| --- | --- | --- |
| Typed on a page of the bank; never on your pages or servers | `3d_host`, `3d_pay_hosting`, hosted pages, `createWithoutCard` flows where the bank page asks | Smallest (SAQ A) |
| Typed on your page, posted straight from the browser to the bank | `createWithoutCard` flows with your own card fields (PayTR, Tosla) | SAQ A-EP |
| Passes through your server | Non-secure, 3D Secure and 3D Pay with a card in the form, every flow that sends the card from your server (PayFlex V4, POSNET, Kuveyt Türk, Vakıf Katılım, Param, iyzico 3D Secure) | SAQ D |

This is not legal advice; confirm the scope with your bank or a QSA. Never store CVV; never log card data.

## Production checklist

- [ ] Production config entry for your bank (`posProductionConfig`), merchant credentials from the environment.
- [ ] Callback URLs are public HTTPS, reachable by the bank; server IP whitelisted where required.
- [ ] `MerchantType` (PayFlex) matches your contract.
- [ ] `require_3d_hash: true` once the bank signs PayFlex callbacks.
- [ ] Callback handler loads the order by id, uses the gateway method and handles `HashMismatchError`,
      `OrderMismatchError` (alerting on `paymentMayHaveCompleted`) and `requires_manual_review`.
- [ ] No automatic retry of payment, cancel or refund calls; after a `PosHttpError` the order is reconciled with
      `pos.status(order)` first.
- [ ] 3D forms are rendered with `render3DFormHtml` from a route of your own (`no-store`, CSP nonce), and bank HTML is
      served as is, never inserted into your page.
- [ ] Idempotent "mark as paid"; reconciliation job against the bank statement.
- [ ] No card data in logs, databases or error trackers.
- [ ] End-to-end test with the bank's test merchant, including a declined card and a failed 3D authentication.
