---
"typescript-pos": minor
---

Add the ParamPos and Param3DHostPos gateways (Param) with ParamPosAccount: verified 3D callbacks bound to the order, 3D Secure provisions and every 3D approval confirmed with the bank's status record, hosted-page payments bound to the order through a derived transaction id, unknown outcomes after money-moving requests reported as errors, and ParamPosQuery with custom queries, history, installment rates and BIN lists; add shared SOAP helpers and mask Param credentials in logs.

KuveytPos now refuses SOAP answers that define a document type or entities.
