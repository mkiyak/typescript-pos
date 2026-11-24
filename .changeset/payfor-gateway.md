---
"typescript-pos": minor
---

Add the PayForPos gateway for QNB Finansbank and Ziraat Katılım (3D Secure, 3D Pay, 3D Host, non-secure, pre/post auth, status, cancel, refund, order history) with verified callbacks, bank-confirmed 3D results and PayForPosQuery custom queries and history. `history()` results may now carry `status: null` when the bank's answer has no overall result (PayFor day reports).
