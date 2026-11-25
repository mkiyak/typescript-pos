# 3D pages in a redirect, an iframe or a popup

Every 3D model ends the same way on the browser side: the payer's browser has to reach a bank page (the card
holder's 3D check, or the bank's card page for hosted models), and the bank sends the browser back to your callback
URL. This guide shows three ways to host that trip and how to render the page that starts it safely.

A runnable sketch of the server side is in [`examples/3d-iframe-popup.ts`](../examples/3d-iframe-popup.ts).

## Choose a presentation

| Presentation | How it works | Use it when |
|---|---|---|
| Full-page redirect | Your checkout page navigates to your own form route; the form posts the browser to the bank; the bank posts it back to your callback route. | Always works. This is the default and the fallback for the other two. |
| iframe (usually in a modal) | Your checkout page shows an `<iframe>` whose `src` is your form route. The bank pages and your callback page load inside the frame. | You want the payer to stay on your page and the bank page can be framed. |
| Popup window | A click on your checkout page opens your form route in a new window with `window.open`. | You cannot frame the bank page but want the checkout page to stay open. |

Things that decide between them:

- **Some bank pages refuse to be framed.** A page sent with `X-Frame-Options: DENY` / `SAMEORIGIN` or a CSP
  `frame-ancestors` that excludes your site shows up as an empty or error frame. Your page cannot detect this reliably
  (the frame's `load` event still fires and its content is cross-origin), so always offer a "continue in this
  window" link that falls back to the full redirect, and fall back on a timeout. Test every bank and model you use in
  its test environment before choosing the iframe.
- **Popups are blocked** unless `window.open` runs directly in a user gesture (the click handler of your pay
  button). If `window.open` returns `null`, fall back to the full redirect.
- **Hosted models keep card data off your pages.** With 3D Host / 3D Pay Hosting (and the hosted pages of PayTR,
  Tosla, iyzico, Param and the VakıfBank common payment page) the card is typed on the bank's page, so neither your
  server nor your form page ever holds it (PCI DSS SAQ A). With 3D Secure and 3D Pay the browser form carries the card
  number, expiry and CVV: prefer the hosted models where the bank offers them.

## What `get3DFormData` returns

The first step is the same for every presentation: your server calls `pos.get3DFormData(...)` for the stored order.
The result is either a form object `{ gateway, method, inputs }` or, for a few gateways and models, an HTML string
that the bank (or the payment provider) returned to your server.

| Gateway | Model | Result (default `formFormat`) | Other `formFormat` |
|---|---|---|---|
| `AssecoPos` | 3D Secure, 3D Pay, 3D Host, 3D Pay Hosting | object, `POST` | `'html'` refused |
| `AkbankPos` | 3D Secure, 3D Pay, 3D Host | object, `POST` | `'html'` refused |
| `GarantiPos` | 3D Secure, 3D Pay | object, `POST` | `'html'` refused |
| `InterPos` | 3D Secure, 3D Pay, 3D Host | object, `POST` | `'html'` refused |
| `PayForPos` | 3D Secure, 3D Pay, 3D Host | object, `POST` | `'html'`: HTML string for 3D Secure and 3D Pay (refused for 3D Host) |
| `PayFlexV4Pos` | 3D Secure | object, `POST` (the card went to the bank from your server) | `'html'` refused |
| `PayFlexCPV4Pos` | 3D Pay, 3D Host | object, `GET` | `'html'` refused |
| `PosNetPos` | 3D Secure | object, `POST` | `'html'` refused |
| `PosNetV1Pos` | 3D Secure | object, `POST` | `'html'` refused |
| `ToslaPos` | 3D Pay | object, `POST` | `'html'` refused |
| `ToslaPos` | 3D Host | object, `GET`, no inputs | `'html'` refused |
| `ParamPos` | 3D Secure, 3D Pay | object, `GET` (inputs taken from the bank's address) | `'html'` refused |
| `Param3DHostPos` | 3D Host | object, `GET` | `'html'` refused |
| `PayTrPos` | 3D Pay | object, `POST` | `'html'` refused |
| `PayTrPos` | 3D Host | object, `GET`, no inputs (the iframe address) | `'html'` refused |
| `IyzicoPos` | 3D Secure | HTML string | `'array'` refused |
| `IyzicoPos` | 3D Host | HTML string (the checkout script) | `'array'`: object, `GET`, no inputs (the payment page) |
| `KuveytPos` | 3D Secure | HTML string | `'array'` refused |
| `VakifKatilimPos` | 3D Secure | HTML string | `'array'` refused |
| `VakifKatilimPos` | 3D Host | object, `POST` | `'html'` refused |

## Render a form object with `render3DFormHtml`

`render3DFormHtml(form, options)` turns a form object into a complete HTML document that submits itself to the bank.
Use it instead of writing the page by hand:

- Every input name and value and the action URL are HTML-escaped (`&`, `<`, `>`, `"`, `'`), so values such as a JSON
  basket, a description with quotes or an attacker-controlled field cannot break out of the form.
- The gateway must be an absolute `https:` URL without user credentials; `http:`, `javascript:`, `data:` and relative
  addresses throw `PosError`, as do an unknown method, a non-string input value, an empty or duplicate input name and a
  malformed nonce.
- For a `GET` form the query of the gateway URL becomes hidden inputs (a browser replaces the query of a `GET` form's
  action with the form fields); a name that appears in both throws `PosError`.
- The page contains no inline event handlers. The only script is the one-line auto-submit, which carries your CSP
  nonce when you pass `nonce`; a `<noscript>` button submits the form when scripts are off. With
  `autoSubmit: false` the page holds only the form and a visible submit button.
- The output is deterministic (same input, same bytes), so you can snapshot it in your tests.

```ts
import { randomBytes } from 'node:crypto'
import { render3DFormHtml } from 'typescript-pos'

const form = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
if (typeof form === 'string') {
  // Bank markup: see "HTML strings" below. Never pass it to render3DFormHtml.
}
const nonce = randomBytes(16).toString('base64')
const body = render3DFormHtml(form, { nonce })
// Headers:
//   Content-Type: text/html; charset=utf-8
//   Cache-Control: no-store
//   Content-Security-Policy: default-src 'none'; script-src 'nonce-<nonce>'; form-action https:; frame-ancestors 'self'; base-uri 'none'
```

Notes on those headers:

- `Cache-Control: no-store`: the page may carry card data (3D Secure / 3D Pay forms) and always carries signed
  one-time values. Never log, cache or store it.
- `script-src 'nonce-…'`: generate a fresh random nonce per response. If your CSP blocks inline scripts and you do not
  pass the nonce, the page stays on the screen with scripts on and no button (the `<noscript>` button only appears
  with scripts off); use `autoSubmit: false` if you cannot set a nonce.
- `form-action https:`: the bank's gateway may redirect to another bank host, and some browsers check redirects of a
  form submission against `form-action` too, so do not pin it to a single host unless you have tested the whole flow.
- `frame-ancestors 'self'`: only your own pages may frame the form page and the callback page.

Input values are sent exactly as given, except that browsers send line breaks inside a value as CR LF (as for any
form). A value with a NUL character or a lone UTF-16 surrogate cannot be sent unchanged and throws `PosError`.

## HTML strings: serve the bank's page as it is

`KuveytPos` and `VakifKatilimPos` 3D Secure, `PayForPos` with `formFormat: 'html'` and `IyzicoPos` (3D Secure, and 3D
Host by default) return HTML that your server received from the bank or the payment provider. That markup is not
yours and must be treated as untrusted:

- Serve it as the whole response of a route of its own (the same form route you would use for a form object), with
  `Cache-Control: no-store`. Point the iframe `src` or the popup at that route.
- Never insert it into your checkout page's DOM (`innerHTML`, `document.write`, `srcdoc`, a template variable left
  unescaped). Scripts in it would run with your page's privileges.
- Do not wrap it in `render3DFormHtml`; the helper refuses strings.
- Served from your origin, the bank's scripts run with your origin. Keep sensitive cookies `HttpOnly`, and consider
  serving that route with `Content-Security-Policy: sandbox allow-forms allow-scripts allow-popups`, which runs the
  page in an opaque origin (no access to your cookies or storage). Test this against the bank's test environment
  first: a page that needs storage, or a bank that refuses requests whose `Origin` is `null`, will not work sandboxed.

## Server routes

A typical setup has four routes. All of them are on your own origin.

1. **Form route** (`GET /pay/3d/:orderId`): loads the stored order for the signed-in customer, calls
   `get3DFormData`, and answers with `render3DFormHtml(...)` (or the bank's HTML string) and the headers above. Point
   the redirect, the iframe `src` or `window.open` at this route. Do not build the page in the browser with `srcdoc` or
   `document.write`: your route can set the CSP, `no-store` and `frame-ancestors` headers, an `about:srcdoc` frame
   cannot.
2. **Callback route** (the `success_url` / `fail_url` you put in the order, for example
   `POST /pay/3d/callback/:orderId`): the bank posts the browser here. Load the order from your own store by the id in
   the path you issued (never by a field the bank posted), call `pos.payment(...)` with the posted body, store the
   result, and answer with a small page that tells the opener "done for order X" (below). Errors such as
   `OrderMismatchError` and `HashMismatchError` are handled here, on the server, exactly as in the gateway guides.
3. **Result route** (`GET /pay/orders/:orderId/state`): returns the stored state of the order to the signed-in
   customer (`pending`, `paid`, `failed`, `review`). The checkout page asks this route after the message arrives, after
   the popup closes, or after a timeout.
4. **Checkout page**: your normal page, served with `frame-ancestors 'self'` (or `'none'`) so nobody else can frame it.

### Cookies on the callback

The bank posts the callback from its own site. In a full redirect that is a cross-site top-level `POST`; in an iframe
it is also a third-party context. Session cookies with `SameSite=Lax` (the browser default) are not sent on a
cross-site `POST`, and many browsers block third-party cookies in frames altogether. Two ways to cope:

- Do not need the session on the callback: put the order id in the callback URL you issue, look the order up by that
  id, and let `pos.payment(...)` bind the callback to it (order id, amount, currency, signature). The result route,
  called later from your checkout page, is first-party and has the session.
- Or set the session cookie with `SameSite=None; Secure`. This does not help where the browser blocks third-party
  cookies in frames, so the first way is more robust.

## The callback page tells its opener

The callback page only says that the 3D trip ended for an order. It never carries the result, and the checkout page
never treats the message as proof of payment: it asks the result route.

```html
<script nonce="…">
  (function () {
    var target = window.parent !== window ? window.parent : window.opener
    var message = { type: 'pos-3d-done', orderId: "ORDER-1" } // JSON-encoded on the server, with < escaped
    if (target) {
      target.postMessage(message, 'https://shop.example') // your own origin, never '*'
    } else {
      window.location.replace('/checkout/result?order=' + encodeURIComponent(message.orderId))
    }
  })()
</script>
```

- The target origin is your own origin as a literal string. With `'*'` any page that framed or opened the callback
  page would learn the order id and could race your checkout page.
- Encode values put into the script with `JSON.stringify` and escape `<` (and U+2028 / U+2029) so an order id cannot
  close the script element.
- Without a parent or opener (the full redirect, or a popup whose opener went away) the page moves on to your result
  page itself.

## The checkout page listens

```js
window.addEventListener('message', function (event) {
  if (event.origin !== window.location.origin) return // only your own callback page
  if (event.source !== expectedSource) return // the frame's contentWindow or the popup you opened
  var data = event.data
  if (!data || data.type !== 'pos-3d-done' || data.orderId !== currentOrderId) return
  closeFrameOrPopup()
  fetch('/pay/orders/' + encodeURIComponent(currentOrderId) + '/state', { credentials: 'same-origin' })
    .then(function (r) { return r.json() })
    .then(showResult)
})
```

- Check `event.origin` against your own origin and `event.source` against the window you created; ignore everything
  else. Other scripts, extensions and frames can post messages to your page too.
- Ask the server for the order's state. Only the result your server stored after `pos.payment(...)` counts.

## Timeouts, closed popups and fallbacks

- **Popup closed early.** Poll `popup.closed` (for example every 500 ms). When it closes without a message, ask the
  result route: the payer may have completed the payment just before closing it.
- **No answer.** Give up waiting after a generous timeout (the bank's 3D page can stay open for minutes; 15 minutes is
  a reasonable upper bound) and ask the result route. Leave the order `pending` if the server has no result yet;
  never mark it failed only because the browser gave up. Check unclear orders later from the server with `status` or
  `orderHistory`, as the gateway guides describe.
- **Popup blocked or frame refused.** Navigate the whole page to the form route (the full redirect). Keep a visible
  "continue in this window" link next to the frame for payers whose bank page stays empty.

## iframe `sandbox`

A `sandbox` attribute on the frame limits what the pages inside it can do. The frame loads your form page and then the
bank's pages, which need scripts, form submission and, often, their own cookies and storage:

```html
<iframe src="/pay/3d/ORDER-1" sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        referrerpolicy="no-referrer" title="Card verification"></iframe>
```

- Without `allow-top-navigation` a page in the frame cannot navigate your checkout page away; a bank page that tries
  to break out of the frame simply stays inside it.
- `allow-same-origin` together with `allow-scripts` means the sandbox is no isolation for pages from your own origin
  (they could remove it); it still restricts the bank's cross-origin pages. Keep your own pages trustworthy and do not
  serve bank HTML strings from the checkout page's DOM.
- Bank pages differ: test the sandbox flags with each bank's test environment. If a bank's page needs more (for example
  `allow-modals` for an alert), add only that flag.

## Checklist

- [ ] The form route sets `Cache-Control: no-store`, a CSP with a fresh nonce and `frame-ancestors 'self'`.
- [ ] Form objects go through `render3DFormHtml`; bank HTML strings are served as they are on their own route.
- [ ] Card data never reaches logs or caches; hosted models are used where the bank offers them.
- [ ] The callback route looks the order up by the id in the URL you issued and calls `pos.payment(...)`.
- [ ] The callback page posts only "done for order X" to your own origin; never `'*'`.
- [ ] The checkout page checks `event.origin` and `event.source`, then asks the server for the order's state.
- [ ] Popup blocked, frame refused, popup closed and timeouts all end in the full redirect or a server check.
