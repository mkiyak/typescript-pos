---
"typescript-pos": patch
---

Amounts that round up to 1e13 (`9999999999999.996`) are refused like 1e13 itself, on every gateway; iyzico answer amounts of 1e13 or more leave the field `null`.

`OrderMismatchError` messages now start with `Order <field> mismatch` (they said `Callback`), since the order is also compared with data the bank returned from a query.

Order ids of 3D callbacks (Asseco, Yapı Kredi and Albaraka POSNET, VakıfBank Common Payment) and Akbank recurring track ids are read as existing order ids before they are compared or sent; an array, object, unsafe number or text with a control character is a `PosError` instead of the text it prints as.

A card passed with a hosted payment model is never written into the browser form, with or without `createWithoutCard`: `3d_host` refuses a card (`PosError`); `3d_pay_hosting` drops it.

POSNET `ref_ret_num` and `auth_code` must be non-blank strings, a Garanti history page must be an integer from 1 to 9999 and a BIN 6 to 8 digits, an Akbank history `batch_num` a positive integer; anything else is a `PosError`. Akbank custom queries no longer format the request time when the caller supplies one.

VakıfBank Common Payment status requests refuse a `transaction_id` or `payment_token` that is not a string instead of dropping it, and its answer's `TransactionId`, `MaskedPan` and `Rrn` are text or `null`. Garanti answer fields that are objects or arrays are `null` instead of `"[object Object]"`. A custom query without any allowed origin says so in its error.
