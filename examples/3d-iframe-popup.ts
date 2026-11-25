// 3D pages in an iframe, a popup or a full redirect (any gateway; Akbank 3D Host here, so no card data reaches your
// server). See guides/3d-iframe-and-popup.md.
// Nothing here runs on import; call the exported functions from your own route handlers. No framework is assumed:
// each page function returns the headers and body to send.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  type AbstractGateway,
  AccountFactory,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
  PosError,
  PosFactory,
  type PosOrder,
  posTestConfig,
  render3DFormHtml,
  TX_TYPE,
} from 'typescript-pos'

type Page = { headers: Record<string, string>; body: string }
type OrderState = 'pending' | 'paid' | 'failed' | 'review'

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new MissingAccountInfoError(`Missing environment variable ${name}`)
  }
  return value
}

let gateway: AbstractGateway | undefined

/** Built on first use and shared: the gateway is stateless. Use posProductionConfig live. */
function pos(): AbstractGateway {
  gateway ??= PosFactory.createPosGateway(
    AccountFactory.createAkbankPosAccount(
      'akbank-pos',
      env('POS_MERCHANT_SAFE_ID'),
      env('POS_TERMINAL_SAFE_ID'),
      env('POS_SECRET_KEY'),
    ),
    posTestConfig,
  )
  return gateway
}

// Replace with your database. Orders hold no card data.
const orders = new Map<string, { order: PosOrder; state: OrderState; callbackToken: string }>()

/**
 * Stores a new payment attempt. The callback URL you issue carries the order id and an unguessable token of this
 * attempt, so the callback finds the order without a cookie and nobody else can post to it. An id that already exists
 * is refused: a retry uses a new order id (and so a new token).
 */
export function createOrder(origin: string, orderId: string, amount: number): PosOrder {
  if (orders.has(orderId)) {
    throw new PosError('An order with this id already exists; a retry needs a new order id')
  }
  const callbackToken = randomBytes(16).toString('base64url') // 128 bits, new for every attempt
  const callback = `${checkedOrigin(origin)}/pay/3d/callback/${encodeURIComponent(orderId)}/${callbackToken}`
  const order: PosOrder = {
    id: orderId,
    amount,
    currency: 'TRY',
    installment: 0,
    success_url: callback,
    fail_url: callback,
  }
  orders.set(orderId, { order, state: 'pending', callbackToken })
  return order
}

/** `GET /pay/3d/:orderId`: the page the redirect, the iframe `src` or `window.open` points at. */
export async function formPage(orderId: string): Promise<Page> {
  // Load the order only for the signed-in customer who owns it (check your session here); never for anyone who knows
  // the id. The form page reveals the callback URL and its token, so this session check is what keeps the token secret.
  const stored = orders.get(orderId)
  if (stored === undefined || stored.state !== 'pending') {
    throw new PosError('No pending order with this id')
  }
  const form = await pos().get3DFormData(stored.order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)

  if (typeof form === 'string') {
    // Bank markup (some gateways and models return it): served as it is, never wrapped or put into your page's DOM.
    // guides/3d-iframe-and-popup.md describes an optional CSP sandbox for this route.
    return {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
      body: form,
    }
  }

  const nonce = randomBytes(16).toString('base64')
  return {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The page may carry card data in other models and always carries signed one-time values.
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action https:; frame-ancestors 'self'; base-uri 'none'`,
      'X-Content-Type-Options': 'nosniff',
    },
    body: render3DFormHtml(form, { nonce }),
  }
}

/**
 * `POST /pay/3d/callback/:orderId/:token`: completes the payment, stores the result and answers with the callback page.
 * Only a verified result bound to the order ends the attempt; anything else leaves it `pending` for a server-side check.
 */
export async function callbackRoute(
  origin: string,
  orderId: string,
  token: string,
  body: Record<string, string | undefined>,
): Promise<Page> {
  const stored = orders.get(orderId) // by the id in the URL you issued, never by a posted field
  if (stored === undefined || !sameToken(token, stored.callbackToken)) {
    // Not the URL you issued for this attempt: nothing is processed and nothing changes.
    throw new PosError('Unknown payment attempt')
  }
  // An attempt that already ended stays as it is: a later callback (a replayed decline, say) never changes it.
  if (stored.state === 'pending') {
    try {
      const response = await pos().payment(MODEL.THREE_D_HOST, stored.order, TX_TYPE.PAY_AUTH, null, body)
      if (response.requires_manual_review === true) {
        stored.state = 'review'
      } else if (response.status === 'approved') {
        stored.state = 'paid'
      } else {
        // A decline that came through this attempt's own URL ends the attempt; retry with a new attempt.
        stored.state = 'failed'
      }
    } catch (error) {
      if (error instanceof OrderMismatchError && error.paymentMayHaveCompleted) {
        stored.state = 'review' // the card may have been charged: check with the bank, void or refund
      } else {
        // HashMismatchError, OrderMismatchError without a charge, PosHttpError…: not a verified result for this order.
        // Log it and leave the attempt pending; check it later from the server with status / orderHistory.
        console.warn('3D callback not accepted', { orderId, error: error instanceof Error ? error.name : 'unknown' })
      }
    }
  }
  return callbackPage(origin, orderId)
}

/** `GET /pay/orders/:orderId/state`: what the checkout page asks after the message, a closed popup or a timeout. */
export function orderState(orderId: string): { state: OrderState } | null {
  const stored = orders.get(orderId)
  return stored === undefined ? null : { state: stored.state }
}

/**
 * The page the bank's callback lands on. It tells the window that opened or framed it only "done for order X",
 * addressed to your own origin; the result stays on the server.
 */
export function callbackPage(origin: string, orderId: string): Page {
  const nonce = randomBytes(16).toString('base64')
  const script =
    '(function () {' +
    ' var target = window.parent !== window ? window.parent : window.opener;' +
    ` var message = ${jsonForScript({ type: 'pos-3d-done', orderId })};` +
    ` if (target) { target.postMessage(message, ${jsonForScript(checkedOrigin(origin))}); }` +
    " else { window.location.replace('/checkout/result?order=' + encodeURIComponent(message.orderId)); }" +
    ' })()'

  return {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'`,
      'X-Content-Type-Options': 'nosniff',
    },
    body:
      '<!doctype html>\n<html><head><meta charset="utf-8"><title>Payment</title></head><body>\n' +
      `<p>You can close this window.</p>\n<script nonce="${nonce}">${script}</script>\n</body></html>\n`,
  }
}

/**
 * The checkout page's script (serve it from a file with your CSP nonce). It opens the form route in an iframe or a
 * popup, falls back to a full redirect, accepts only messages from your own callback page in the window it opened,
 * and then asks your server for the order's state; a message is never proof of payment. A `pending` state after the popup
 * closed early means the payment is still running: keep waiting and ask again later.
 */
export function parentListenerScript(origin: string): string {
  const base = jsonForScript(`${checkedOrigin(origin)}/pay/3d/`)
  return `(function () {
  var FORM_BASE = ${base};
  var TIMEOUT_MS = 15 * 60 * 1000;
  var current = null;

  function redirect(orderId) { window.location.assign(FORM_BASE + encodeURIComponent(orderId)); }

  function finish(orderId) {
    if (current === null || current.orderId !== orderId) return;
    var done = current;
    current = null;
    clearTimeout(done.timer);
    clearInterval(done.poll);
    if (done.frame) done.frame.remove();
    if (done.popup && !done.popup.closed) done.popup.close();
    fetch('/pay/orders/' + encodeURIComponent(orderId) + '/state', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        document.dispatchEvent(new CustomEvent('pos-3d-result', { detail: { orderId: orderId, result: result } }));
      });
  }

  // Call from the pay button's click handler (a popup needs the user gesture).
  window.startPosPayment = function (orderId, mode, container) {
    if (mode === 'popup') {
      var popup = window.open(FORM_BASE + encodeURIComponent(orderId), 'pos3d', 'width=500,height=700');
      if (!popup) return redirect(orderId);
      current = { orderId: orderId, source: popup, popup: popup };
      current.poll = setInterval(function () { if (popup.closed) finish(orderId); }, 500);
    } else if (mode === 'iframe') {
      var frame = document.createElement('iframe');
      frame.src = FORM_BASE + encodeURIComponent(orderId);
      frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-popups');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.title = 'Card verification';
      container.appendChild(frame);
      current = { orderId: orderId, source: frame.contentWindow, frame: frame };
    } else {
      return redirect(orderId);
    }
    current.timer = setTimeout(function () { finish(orderId); }, TIMEOUT_MS);
  };

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (current === null || event.source !== current.source) return;
    var data = event.data;
    if (!data || data.type !== 'pos-3d-done' || data.orderId !== current.orderId) return;
    finish(current.orderId);
  });
})();
`
}

/** An https origin exactly as `URL` writes it (no path, no trailing slash). */
function checkedOrigin(origin: string): string {
  if (!URL.canParse(origin) || new URL(origin).origin !== origin || !origin.startsWith('https://')) {
    throw new PosError('origin must be an https origin such as https://shop.example')
  }
  return origin
}

/** Constant-time comparison of the posted token with the stored one (hashes first, so lengths never leak). */
function sameToken(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/** JSON that is safe inside an inline <script>: nothing in it can close the element or end a JS string early. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')
}
