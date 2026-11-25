---
"typescript-pos": patch
---

Add operation guides (payment models, after-payment cancel/refund/status/history, pre-authorization and capture), a guide index, and security definitions for `requires_manual_review`, `paymentMayHaveCompleted`, unknown outcomes, card-free forms and order ids.

Add examples for the hosted Param page, operations after a payment (cancel, refund, status) and pre-authorization with capture.

Update both READMEs: link the guide index and the new guides, summarise the library-wide rules (card-free forms, order ids, unknown outcomes, result keys), mention `render3DFormHtml`, list every test configuration key and add an upgrade note for 0.14.
