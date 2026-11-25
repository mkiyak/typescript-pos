---
"typescript-pos": minor
---

Breaking: a payment, pre-/post-authorization, 3D provision or refund whose bank answer is empty or carries no result code now rejects with PosHttpError (outcome unknown) instead of returning a declined response, for every gateway; check status() before retrying. Asseco 3D Secure callbacks must now match the order id, amount and currency before the provision.

Breaking: custom response mappers implementing `ResponseDataMapperInterface` must add `readProcReturnCode(raw): string | null`, the bank's result code of a raw answer, or `null` when the answer carries none.
