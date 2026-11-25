---
"typescript-pos": minor
---

Add the PayTrPos gateway (PayTR) with PayTrPosAccount: iFrame (3D Host), Direct API 3D Pay (also without card data on your server) and non-secure payments, status, refund and partial refund; payment results are taken only from the signed server-to-server notification and bound to the order's id and amount, browser returns never approve, unknown outcomes after money-moving requests are reported as errors; add PayTrPosQuery with custom queries, history, installment rates and BIN lookups; mask PayTR tokens and card fields in logs.
