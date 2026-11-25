# Guides

Task-oriented guides for `typescript-pos`. Start with [Payment models](./payment-models.md) to pick how the card is
collected, then read the guide of your bank, then the operation and security guides before you go live.

The [package README](../README.md) has the install steps, the quick start and the list of supported gateways.
Compile-checked code for the flows lives in [`examples/`](../examples).

## Integration

| Guide | What it covers |
|---|---|
| [Payment models](./payment-models.md) | The five payment models, who collects the card, PCI scope in plain words, the `get3DFormData` to `payment` call sequence and which gateway offers which model |
| [3D pages in a redirect, an iframe or a popup](./3d-iframe-and-popup.md) | Showing the bank's 3D page in the checkout, `render3DFormHtml`, the server routes, `postMessage` rules and the fallbacks |

## Gateways

One guide per bank integration: configuration, the flow for each model, callback checks and the bank-specific notes.

| Guide | Gateway | Banks |
|---|---|---|
| [Asseco](./asseco-3d-payment.md) | `AssecoPos` | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, QNB Finansbank (Asseco) |
| [PayFlex V4](./payflex-3d-payment.md) | `PayFlexV4Pos` | VakıfBank, Ziraat (PayFlex) |
| [VakıfBank Common Payment](./payflex-cp-payment.md) | `PayFlexCPV4Pos` | VakıfBank hosted payment page |
| [Garanti BBVA](./garanti-3d-payment.md) | `GarantiPos` | Garanti BBVA |
| [Akbank](./akbank-pos-payment.md) | `AkbankPos` | Akbank (virtual POS API) |
| [Yapı Kredi POSNET](./posnet-3d-payment.md) | `PosNetPos` | Yapı Kredi |
| [Albaraka POSNET](./posnet-v1-3d-payment.md) | `PosNetV1Pos` | Albaraka Türk |
| [PayFor](./payfor-payment.md) | `PayForPos` | QNB Finansbank (PayFor), Ziraat Katılım (PayFor) |
| [InterVPOS](./interpos-payment.md) | `InterPos` | Denizbank |
| [Kuveyt Türk](./kuveytpos-payment.md) | `KuveytPos` | Kuveyt Türk |
| [Vakıf Katılım](./vakif-katilim-payment.md) | `VakifKatilimPos` | Vakıf Katılım |
| [Tosla](./tosla-payment.md) | `ToslaPos` | Tosla |
| [Param](./param-payment.md) | `ParamPos`, `Param3DHostPos` | Param (TURK Elektronik Para) |
| [PayTR](./paytr-payment.md) | `PayTrPos` | PayTR |
| [iyzico](./iyzico-payment.md) | `IyzicoPos` | iyzico |

## Operations

| Guide | What it covers |
|---|---|
| [After a payment](./after-payment.md) | `cancel`, `refund` (full and partial), `status` and `orderHistory`: the order fields each gateway needs, the result keys every call returns, and what to do when the bank's answer does not say what happened |
| [Pre-authorization and capture](./pre-auth-and-capture.md) | Reserving an amount with `TX_TYPE.PAY_PRE_AUTH`, capturing it with `TX_TYPE.PAY_POST_AUTH`, and which gateway offers what |

## Queries

| Guide | What it covers |
|---|---|
| [Queries](./queries.md) | `PosQueryFactory`, `customQuery`, `history`, installment rates and prices and BIN lists, with the per-gateway support table |

## Security

| Guide | What it covers |
|---|---|
| [Security and production checklist](./security.md) | How each gateway verifies callbacks, what `requires_manual_review` and `paymentMayHaveCompleted` mean, unknown outcomes, card-free forms, order ids, PCI scope and the go-live checklist |
