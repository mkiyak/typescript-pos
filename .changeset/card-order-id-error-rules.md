---
"typescript-pos": minor
---

Breaking: with `createWithoutCard: true` a card passed to `get3DFormData` is no longer put into the 3D form (Asseco, Garanti, Akbank, Albaraka POSNET, PayFor in both form formats, InterPos, PayTR; Tosla already did this); the payer enters the card on the bank page. Pass `createWithoutCard: false` when your own page posts the card.

Breaking: order ids must be 1-64 letters, digits, `_` or `-`, starting with a letter or digit (Yapı Kredi and Albaraka POSNET: 1-20; VakıfBank Common Payment: no `_`), and a number is accepted only as a safe non-negative integer; any other id now throws `PosError` before a request is sent on every gateway (Asseco, Garanti, Akbank and PayFlex V4 accepted any value before; PayFor, InterPos, POSNET and VakıfBank Common Payment accepted a leading `_` or `-`).

Breaking: `IyzicoPos.make3DPayPayment` now rejects with `UnsupportedPaymentModelError` (was `UnsupportedTransactionTypeError`), like every other gateway's payment-model method; `payment()` with the 3D Pay model still throws `UnsupportedTransactionTypeError`.
