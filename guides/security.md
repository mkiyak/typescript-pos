# Security and production checklist

Report vulnerabilities privately: see [SECURITY.md](../SECURITY.md).

## What the library does for you

- **The 3D hash is always verified** and cannot be turned off. Comparison is constant time. A missing, empty or
  non-string hash raises `HashMismatchError`.
- **Order binding.** Asseco 3D Pay / 3D Host callbacks must carry your order id and amount; PayFlex callbacks must carry
  your amount, currency and merchant id (`OrderMismatchError` otherwise).
- **Strict 3D.** PayFlex accepts only a fully authenticated result (Status `Y`, ECI `02`/`05`, CAVV, `MdStatus` 1).
- **Manual-review flag.** When a bank authorized money although 3D failed, the response is `declined` with
  `requires_manual_review: true`.
- **Masking.** Everything handed to your logger, error snippets and `OrderMismatchError.response.all` goes through
  `maskSensitiveData()` (PAN, CVV, expiry, passwords, store keys).
- **No network on import**, two runtime dependencies, global `fetch`.

## What you must do

1. **Callbacks.** Look the order up by id on the server; the bank POSTs cross-site so session cookies may be missing.
   Always call the gateway method for the callback and never trust callback fields directly. Exempt the callback route
   from CSRF protection (the hash authenticates it) but nothing else.
2. **Persist before redirecting.** Store the order (`id`, `amount`, `currency`) before the customer leaves, and mark
   it paid only from the gateway response, in an idempotent update (callbacks can be replayed or arrive twice).
3. **Manual review.** Handle `requires_manual_review` and `OrderMismatchError.response` (see the gateway guides): alert,
   reconcile with the bank panel / `pos.status()`, void or refund.
4. **PayFlex: enable `require_3d_hash`** as soon as your bank sends a `Hash` field in the callback. Until then the
   order binding compares browser-supplied values.
5. **Network.** VakıfBank requires server IP whitelisting and public HTTPS callback URLs without `localhost`. Use
   HTTPS everywhere; never expose the store key, merchant password or terminal id to the browser.
6. **Secrets.** Keep merchant credentials in environment variables or a secret manager, not in the repository.
7. **Logging.** Pass your logger via `createPosGateway(..., { logger })`. Do not log request or callback bodies
   yourself: they contain card data and keys.
8. **Timezones.** Bank timestamps without an offset are interpreted as Türkiye time (UTC+03:00), independent of the
   server timezone.
9. **Keep dependencies current** and watch the changelog: before 1.0 minor versions may break.

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
      `OrderMismatchError` and `requires_manual_review`.
- [ ] Idempotent "mark as paid"; reconciliation job against the bank statement.
- [ ] No card data in logs, databases or error trackers.
- [ ] End-to-end test with the bank's test merchant, including a declined card and a failed 3D authentication.
