---
"typescript-pos": minor
---

Add the IyzicoPos gateway (iyzico) with IyzicoPosAccount: 3D Secure, 3D Host (checkout form) and non-secure payments and pre-authorizations, post-authorization, cancel, refund and partial refund, status and order history; every request is signed (IYZWSv2), iyzico's callback and answer signatures are verified and every payment approval (sale, authorization, capture, checkout record) is bound to the order's basket id, amount, currency and phase, refunds are signed and bound to the payment id and amount, cancel answers are unsigned and checked only for the conversation id and payment id when present, fraud reviews are flagged for manual review and unknown outcomes after money-moving requests are reported as errors; add IyzicoPosQuery with custom queries, history, installment prices and BIN lookups; add GET requests to the HTTP layer; mask iyzico authorization headers and card fields in logs.
