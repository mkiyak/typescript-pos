---
"typescript-pos": patch
---

Credentials a request carries in its body (`Password`, `MerchantPassword`, `UserPass` on the Asseco, PayFlex V4, VakıfBank Common Payment, PayFor and InterPos clients, as the Param, PayTR and iyzico clients already did) are hidden from thrown errors and every log line, also when a failing bank page echoes them in free text, cut at the 500-character snippet edge or in an ISO-8859-9 page; the "parsing bank response failed" log line shows the answer decoded with its own charset.

Log masking of JSON text now covers every sensitive key (`StoreKey`, `SecretKey`, `store_key`, `terminalId`, `cardNumber` …) with string or number values, also inside a JSON text that was itself put into a JSON string (`{\"cvv\":\"123\"}`); a card number under such a key is now hidden whole instead of as its first six and last four digits. A masked `Error` keeps its masked `cause`, and `maskSensitiveData(error)` is typed as a plain record.

Bank answers above 10 MiB are refused with `PosHttpError('Bank answer is too large')` without reading or keeping the body (`HttpTransport` option `maxResponseBytes`); after a money request this is an unknown outcome like any other transport error.

A VakıfBank Common Payment payment token that contradicts the order is logged by length only.
