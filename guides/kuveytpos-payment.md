# KuveytPos payments (Kuveyt Türk)

Gateway `KuveytPos`, bank key `kuveytpos`. Complete compile-checked code:
[`examples/kuveytpos-3d-secure.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/kuveytpos-3d-secure.ts).

Status: unit-tested; the request and callback hashes and the kuruş amount conversion are differential-tested against
PHP built-ins (1,000 random sets each, 0 mismatches).

## Bank and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createBoaPosAccount(
  'kuveytpos', // key of `banks` in the config
  merchantId,
  username,
  customerNumber,
  password, // the API password: it signs requests and verifies callbacks
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created. `success_url` and `fail_url`
are required for 3D Secure; banks and their firewalls usually need public HTTPS URLs without `localhost`.

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Secure | `MODEL.THREE_D_SECURE` | Your server posts the card to the bank, shows the bank's 3D page, and after the callback sends the provision. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server sale, no 3D step. |

There is no pre-authorization, 3D Pay, 3D Host or order history, and no query class. Other operations: `status`,
`cancel` and `refund` (full or partial).

## 3D Secure flow

The order needs a few fields beyond the usual ones:

- `ip`: the customer's IP address;
- `payment_channel`: `'01'` (mobile) or `'02'` (web);
- `buyer`: `email`, `gsm_number_cc`, `gsm_number`;
- `billing_address`: `city`, `country` (ISO numeric code), `address`, `zip_code`, `state`.

1. Persist the order (`id`, `amount`, `currency`, `installment`) and tie it to the customer's session.
2. `pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)` posts the card from your server and
   returns the bank's HTML page as a string. That is the bank's markup and untrusted: serve it as its own response
   (the bank's page), never merge it into one of yours. Do not store the card; nothing later needs it.
3. The customer authenticates; the bank POSTs `AuthenticationResponse` to your `success_url` or `fail_url`.
4. Load the order from the customer's session and call
   `pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)`. The library then sends the provision.

```ts
const html = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

`formFormat: 'array'` is refused: there is no form to post from the browser.

## Callback handling

- **The signature is always verified.** A callback that carries the bank's `HashData` is verified for every outcome;
  a wrong hash throws `HashMismatchError`, and an approval must carry it. It cannot be switched off. The bank signs
  only the order id, the response code and its own order id; amount, currency and installment count are not
  signed, which is why they are bound to your order below. The signed fields must be plain text, `MD` must be text and `VPosMessage` a record; any other value that is not
  plain text becomes null.
- **Unsigned callbacks** can only become a decline, and `require_3d_hash: true` rejects unsigned declines too. An
  unsigned decline carries none of the callback's values except bounded decline reasons, and never sets
  `requires_manual_review`.
- **The provision is built from your order**: amount, currency, installment and order id come from the order, never
  from the callback, which only lends the bank's session value. The signed order id must equal the order's
  (`OrderMismatchError`, nothing is sent), and the bank's answer must name your order, amount and currency; a
  mismatch throws `OrderMismatchError` with `paymentMayHaveCompleted: true` and `error.response` set: alert someone,
  then cancel or refund.
- **A signed decline is not bound to your order.** Never use its `order_id` to look up an order.
- **Unclear answers.** After a provision or a sale, an empty or unclear bank answer throws `PosHttpError` or
  `OrderMismatchError` (with `paymentMayHaveCompleted`). Keep the order pending and re-check it later with
  `pos.status(order)`; never retry the payment blindly.
- **Hooks.** The request is signed before `onRequestDataPrepared` runs, so a hook that edits a field covered by
  `HashData` makes the bank reject the request. Use hooks to inspect, not to change signed values.
- **Echoed secrets.** The hashed password the bank echoes (`HashPassword`) is replaced with `***` in `all` and
  `3d_all`, so storing a response does not store it.
- **Complete each order once.** Mark it paid in an idempotent update; a replayed callback must not ship the goods twice.

## Order ids and amounts

- An order id is 1 to 64 letters, digits, `_` or `-`, starting with a letter or digit. Use ids of one fixed length (zero-padded numbers or UUID-based
  ids): one id must never be another id plus extra characters, because the signed values have no separators.
- Amounts go to the bank in kuruş, rounded like PHP `number_format` (`1.15` becomes `115`).

## Cancel and refund

`cancel` and `refund` need these values from the sale's result on the order: `remote_order_id`, `ref_ret_num`,
`auth_code`, `transaction_id`, and the `amount`. For a partial refund set `order_amount` to the sale total and
`amount` to the refund amount; the refund amount is what is sent.

## Queries

Kuveyt Türk has no query service, so there is no `KuveytPosQuery`.
