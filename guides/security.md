# Security and production checklist

Report vulnerabilities privately: see [SECURITY.md](https://github.com/mkiyak/typescript-pos/blob/main/SECURITY.md).

## What the library does for you

- **Hash verification, per gateway.** Comparison is constant time, and no option disables it.
  - `AssecoPos`: hash verification cannot be turned off; a valid hash is always required; a missing, empty or non-string `HASH` raises `HashMismatchError`.
  - `PayFlexV4Pos`: a `Hash` that is present is always verified (`HashMismatchError` on mismatch). A callback
    without `Hash` is rejected only with `require_3d_hash: true`; otherwise (and for declined callbacks, which are
    mapped without a provision request) the defence is the strict 3D rule, the order-binding guard and the bank's
    own CAVV / MpiTransactionId checks at provision time.
- **Garanti.** The callback signature cannot be disabled and signed callbacks must carry the bank's fixed field list;
  an approved payment is never accepted from an unsigned callback (`require_3d_hash: true` also rejects unsigned
  declines), and the callback's terminal id and order id must equal your account and order (`OrderMismatchError`).
- **Akbank (`AkbankPos`).** Every request is signed with the secret key and every callback is verified; 3D Pay and
  3D Host callbacks must be signed, and an approved result is confirmed with the bank (one signed order-history request)
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
- **POSNET (`PosNetPos`).** The 3D result is decrypted by the bank and its MAC is verified before any money moves;
  the bank-resolved order id, amount, currency and installment count must equal your order's (`OrderMismatchError`,
  nothing charged). The check cannot be disabled.
- **POSNET (`PosNetV1Pos`).** The callback signature cannot be disabled; the signed fields are pinned to the
  bank's formats, the echoed order id, amount, currency, merchant and transaction type are compared with your order
  (`OrderMismatchError`), and the provision always charges your order's own amount.
- **Order binding.** Signed Garanti callbacks must carry your terminal id and order id, and the echoed amount, currency and payment model are compared too. Asseco 3D callbacks must carry your order id, amount and the storetype of the payment model they
  are completed with; PayFlex callbacks must carry your amount, currency and merchant id (`OrderMismatchError`
  otherwise). Prefer fixed-length order ids (zero-padded or UUID-based): they leave no ambiguity about where the
  order id ends in a signed callback.
- **Strict 3D.** PayFlex accepts only a fully authenticated result (Status `Y`, ECI `02`/`05`, CAVV, `MdStatus` 1).
- **Manual-review flag.** When a bank authorized money although 3D failed, the response is `declined` with
  `requires_manual_review: true` (Asseco, Garanti, Akbank 3D Pay/Host, PayFor, InterPos and Tosla; Kuveyt Türk and Vakıf Katılım flag the result attached to an `OrderMismatchError` the same way, and a Vakıf Katılım 3D Host alert can be provoked by a forger, so re-query `status` first; for an unsigned PayFor callback, for InterPos and for Tosla only
  when the bank's own record shows the payment). When a signed Asseco or Garanti callback reports a completed payment but does not belong to
  the order, `OrderMismatchError.paymentMayHaveCompleted` is `true`.
- **Masking.** Everything handed to your logger, error snippets and `OrderMismatchError.response.all` goes through
  `maskSensitiveData()` (PAN, CVV, expiry, passwords, store keys).
- **HTTPS only.** `PosFactory` rejects bank endpoints that are not `https:` URLs, and HTTP redirects are never
  followed (a 307/308 would resend card data and credentials to another host); both raise `PosError`/`PosHttpError`.
- **No network on import**, two runtime dependencies, global `fetch`.

## What you must do

1. **Callbacks.** Look the order up by id on the server; the bank POSTs cross-site so session cookies may be missing.
   Always call the gateway method for the callback and never trust callback fields directly. Exempt the callback route
   from CSRF protection (Asseco: the hash authenticates it; PayFlex: the hash when present, plus the checks above) but
   nothing else.
2. **Persist before redirecting.** Store the order (`id`, `amount`, `currency`) before the customer leaves, and mark
   it paid only from the gateway response, in an idempotent update (callbacks can be replayed or arrive twice).
3. **Manual review.** Handle `requires_manual_review`, and `OrderMismatchError.paymentMayHaveCompleted` with
   `OrderMismatchError.response` (see the gateway guides): alert, reconcile with the bank panel / `pos.status()`,
   void or refund.
4. **PayFlex: enable `require_3d_hash`** as soon as your bank sends a `Hash` field in the callback. Until then the
   order binding compares browser-supplied values.
5. **Network.** VakıfBank requires server IP whitelisting and public HTTPS callback URLs without `localhost`. Use
   HTTPS everywhere; never expose the store key, merchant password or terminal id to the browser.
6. **Secrets.** Keep merchant credentials in environment variables or a secret manager, not in the repository.
7. **Logging.** Pass your logger via `createPosGateway(..., { logger })`. Do not log request or callback bodies
   yourself: they contain card data and keys.
8. **Outcome unknown: never retry payments blindly.** A `PosHttpError` (timeout, non-2xx, HTML/WAF page) after a
   request that moves money (provisioning, non-3D payment, post-authorization, cancel, refund) may arrive after the
   bank has processed it. Call `pos.status(order)` before any retry; retry only when the bank has no record of it.
   The same applies to your own job queues and HTTP retry middleware: never wrap payment calls in automatic retries.
9. **Timezones.** Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00), independent of the
   server timezone.
10. **Keep dependencies current** and watch the changelog: before 1.0 minor versions may break.

## PCI DSS

| Model                                | Card data on your server | Typical scope |
| ------------------------------------ | ------------------------ | ------------- |
| Asseco 3D Pay Hosting / 3D Host      | No (typed on the bank page) | Smallest (SAQ A / A-EP, confirm with your acquirer) |
| Asseco 3D Pay / 3D Secure / non-3D   | Yes                      | SAQ D         |
| PayFlex V4 3D Secure (MPI)           | Yes (enrollment and provision) | **SAQ D** |

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
- [ ] Idempotent "mark as paid"; reconciliation job against the bank statement.
- [ ] No card data in logs, databases or error trackers.
- [ ] End-to-end test with the bank's test merchant, including a declined card and a failed 3D authentication.
