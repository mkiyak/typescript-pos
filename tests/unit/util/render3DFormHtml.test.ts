import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { MODEL, TX_TYPE } from '../../../src/PosInterface.js'
import type { ThreeDFormData } from '../../../src/types.js'
import { render3DFormHtml } from '../../../src/util/render3DFormHtml.js'

const SUBMIT = "HTMLFormElement.prototype.submit.call(document.getElementById('pos-3d-form'))"

function post(inputs: Record<string, string>, gateway = 'https://bank.example/3d'): ThreeDFormData {
  return { gateway, method: 'POST', inputs }
}

function get(inputs: Record<string, string>, gateway: string): ThreeDFormData {
  return { gateway, method: 'GET', inputs }
}

function expectPosError(fn: () => unknown, message: RegExp): void {
  let thrown: unknown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(PosError)
  expect((thrown as Error).constructor).toBe(PosError)
  expect((thrown as Error).message).toMatch(message)
}

/** The hidden inputs of a rendered page, as written. */
function inputLines(html: string): string[] {
  return html.split('\n').filter((line) => line.startsWith('<input '))
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('render3DFormHtml', () => {
  // addition: D3 the whole document for one fixture, byte for byte
  it('renders the whole auto-submit document with a nonce', () => {
    const html = render3DFormHtml(
      post(
        { clientid: '700655000200', amount: '10.01', description: `Tom's "deal" <b>&</b>` },
        'https://bank.example/fim/est3Dgate?x=1&y=2',
      ),
      { nonce: 'abcDEF123+/=_-' },
    )

    expect(html).toBe(
      '<!doctype html>\n' +
        '<html><head><meta charset="utf-8"><title>Redirecting to the bank</title></head><body>\n' +
        '<form id="pos-3d-form" method="post" action="https://bank.example/fim/est3Dgate?x=1&amp;y=2">\n' +
        '<input type="hidden" name="clientid" value="700655000200">\n' +
        '<input type="hidden" name="amount" value="10.01">\n' +
        '<input type="hidden" name="description" value="Tom&#39;s &quot;deal&quot; &lt;b&gt;&amp;&lt;/b&gt;">\n' +
        '<noscript><button type="submit">Continue</button></noscript></form>\n' +
        `<script nonce="abcDEF123+/=_-">${SUBMIT}</script>\n` +
        '</body></html>\n',
    )
  })

  // addition: D3 no nonce attribute without the option
  it('renders the script without a nonce attribute when no nonce is given', () => {
    const html = render3DFormHtml(post({ a: '1' }))

    expect(html).toBe(
      '<!doctype html>\n' +
        '<html><head><meta charset="utf-8"><title>Redirecting to the bank</title></head><body>\n' +
        '<form id="pos-3d-form" method="post" action="https://bank.example/3d">\n' +
        '<input type="hidden" name="a" value="1">\n' +
        '<noscript><button type="submit">Continue</button></noscript></form>\n' +
        `<script>${SUBMIT}</script>\n` +
        '</body></html>\n',
    )
    expect(html).not.toContain('nonce')
    expect(render3DFormHtml(post({ a: '1' }), {})).toBe(html)
    expect(render3DFormHtml(post({ a: '1' }), { autoSubmit: true })).toBe(html)
  })

  // addition: D3 autoSubmit false renders the form and a visible submit button only
  it('renders only the form and a visible button with autoSubmit false', () => {
    const html = render3DFormHtml(post({ a: '1' }), { autoSubmit: false, nonce: 'abcdefgh' })

    expect(html).toBe(
      '<!doctype html>\n' +
        '<html><head><meta charset="utf-8"><title>Redirecting to the bank</title></head><body>\n' +
        '<form id="pos-3d-form" method="post" action="https://bank.example/3d">\n' +
        '<input type="hidden" name="a" value="1">\n' +
        '<button type="submit">Continue</button></form>\n' +
        '</body></html>\n',
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<noscript')
  })

  // addition: D3 the auto-submit does not depend on the form's `submit` property, which an input named `submit`
  // replaces in the browser
  it('submits through the form prototype so an input named submit cannot break it', () => {
    const html = render3DFormHtml(post({ submit: 'x', action: 'y', method: 'z', id: 'w' }))

    expect(html).toContain(`<script>${SUBMIT}</script>`)
    expect(html).toContain('<form id="pos-3d-form" method="post" action="https://bank.example/3d">')
    expect(inputLines(html)).toEqual([
      '<input type="hidden" name="submit" value="x">',
      '<input type="hidden" name="action" value="y">',
      '<input type="hidden" name="method" value="z">',
      '<input type="hidden" name="id" value="w">',
    ])
  })

  it('renders an empty form when there are no inputs', () => {
    const html = render3DFormHtml(post({}))

    expect(inputLines(html)).toEqual([])
    expect(html).toContain(
      '<form id="pos-3d-form" method="post" action="https://bank.example/3d">\n<noscript><button type="submit">Continue</button></noscript></form>',
    )
  })

  it('is deterministic', () => {
    const form = post({ b: '2', a: '1', ü: 'ğ' })

    expect(render3DFormHtml(form, { nonce: 'abcdefgh' })).toBe(render3DFormHtml(form, { nonce: 'abcdefgh' }))
  })

  it('keeps the insertion order of the inputs', () => {
    const html = render3DFormHtml(post({ z: '1', a: '2', m: '3' }))

    expect(inputLines(html)).toEqual([
      '<input type="hidden" name="z" value="1">',
      '<input type="hidden" name="a" value="2">',
      '<input type="hidden" name="m" value="3">',
    ])
  })

  describe('escaping', () => {
    it('escapes a value that tries to close the attribute and open a script', () => {
      const html = render3DFormHtml(post({ a: '"><script>alert(1)</script>' }), { autoSubmit: false })

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="a" value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">',
      ])
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert(1)</script>')
    })

    it('escapes a single-quote attack in a value', () => {
      const html = render3DFormHtml(post({ a: "' onfocus='alert(1)' autofocus='" }))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="a" value="&#39; onfocus=&#39;alert(1)&#39; autofocus=&#39;">',
      ])
    })

    it('escapes a name containing a single quote and markup', () => {
      const html = render3DFormHtml(post({ "it's": '1', 'a"><img src=x>': '2' }))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="it&#39;s" value="1">',
        '<input type="hidden" name="a&quot;&gt;&lt;img src=x&gt;" value="2">',
      ])
    })

    it('escapes text that already looks escaped exactly once', () => {
      const html = render3DFormHtml(post({ 'a&amp;b': '&amp; &lt; &#39; &quot;' }))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="a&amp;amp;b" value="&amp;amp; &amp;lt; &amp;#39; &amp;quot;">',
      ])
    })

    it('escapes a value that tries to close the form', () => {
      const html = render3DFormHtml(post({ '</form><form action="https://evil.example">': '</form>' }))

      expect(count(html, '</form>')).toBe(1)
      expect(count(html, '<form')).toBe(1)
      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="&lt;/form&gt;&lt;form action=&quot;https://evil.example&quot;&gt;" value="&lt;/form&gt;">',
      ])
    })

    it('escapes every one of the five characters in names and values', () => {
      const html = render3DFormHtml(post({ '&<>"\'': '&<>"\'' }))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="&amp;&lt;&gt;&quot;&#39;" value="&amp;&lt;&gt;&quot;&#39;">',
      ])
    })

    it('escapes the gateway URL', () => {
      const html = render3DFormHtml(post({}, `https://bank.example/3d?a=1&b="x"&c='y'&d=<z>`))

      expect(html).toContain(
        'action="https://bank.example/3d?a=1&amp;b=&quot;x&quot;&amp;c=&#39;y&#39;&amp;d=&lt;z&gt;"',
      )
    })

    it('keeps unicode, emoji, U+2028 and U+2029 as they are', () => {
      const value = 'Şeker Ğıda 💳  line para é'
      const html = render3DFormHtml(post({ 'açıklama💳': value }))

      expect(inputLines(html)).toEqual([`<input type="hidden" name="açıklama💳" value="${value}">`])
    })

    it('keeps a value that looks like a script URL as plain text', () => {
      const html = render3DFormHtml(post({ okUrl: 'javascript:alert(1)' }))

      expect(inputLines(html)).toEqual(['<input type="hidden" name="okUrl" value="javascript:alert(1)">'])
    })

    it('keeps JSON text intact (escaped once)', () => {
      const html = render3DFormHtml(post({ user_basket: '[["Ürün \\"A\\"","10.00",1]]' }))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="user_basket" value="[[&quot;Ürün \\&quot;A\\&quot;&quot;,&quot;10.00&quot;,1]]">',
      ])
    })
  })

  describe('gateway URL', () => {
    it.each([
      ['http://bank.example/3d'],
      ['javascript:alert(1)'],
      ['JavaScript:alert(1)'],
      ['data:text/html,<script>alert(1)</script>'],
      ['/relative/3d'],
      ['//bank.example/3d'],
      ['bank.example/3d'],
      [''],
      [' https://bank.example/3d'],
      ['https://bank.example/3d '],
      ['https://bank.example/\n3d'],
      ['https://bank.example/3\t'],
      ['https://bank.example\u0000/3d'],
      ['https://'],
      ['https://user:pass@bank.example/3d'],
      ['https://bank.example@evil.example/3d'],
      ['ftp://bank.example/3d'],
      ['wss://bank.example/3d'],
    ])('refuses %j', (gateway) => {
      expectPosError(() => render3DFormHtml(post({ a: '1' }, gateway)), /gateway/)
    })

    it.each([[undefined], [null], [1], [{}], [['https://bank.example']]])(
      'refuses a non-string gateway %j',
      (gateway) => {
        expectPosError(
          () => render3DFormHtml({ gateway, method: 'POST', inputs: {} } as unknown as ThreeDFormData),
          /gateway/,
        )
      },
    )

    it('accepts an https URL with port, query and fragment', () => {
      const html = render3DFormHtml(post({}, 'https://bank.example:8443/3d/Pay.aspx?x=1#top'))

      expect(html).toContain('action="https://bank.example:8443/3d/Pay.aspx?x=1#top"')
    })

    it('accepts an upper-case scheme', () => {
      expect(render3DFormHtml(post({}, 'HTTPS://bank.example/3d'))).toContain('action="HTTPS://bank.example/3d"')
    })
  })

  describe('method', () => {
    it.each([['post'], ['get'], ['PUT'], ['DELETE'], [''], [undefined], [null], [1]])('refuses %j', (method) => {
      expectPosError(
        () =>
          render3DFormHtml({
            gateway: 'https://bank.example/3d',
            method,
            inputs: {},
          } as unknown as ThreeDFormData),
        /method/,
      )
    })

    it('renders a GET form', () => {
      const html = render3DFormHtml(get({ Ptkn: 'abc' }, 'https://bank.example/pay'))

      expect(html).toContain('<form id="pos-3d-form" method="get" action="https://bank.example/pay">')
      expect(inputLines(html)).toEqual(['<input type="hidden" name="Ptkn" value="abc">'])
    })

    it('moves the query of a GET URL into hidden inputs, first, and drops it from the action', () => {
      const html = render3DFormHtml(get({ b: '2' }, 'https://h/p?a=1'))

      expect(html).toContain('<form id="pos-3d-form" method="get" action="https://h/p">')
      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="a" value="1">',
        '<input type="hidden" name="b" value="2">',
      ])
    })

    it('decodes the query of a GET URL and escapes it again', () => {
      const html = render3DFormHtml(get({}, 'https://h/p?token=a%2Bb%3D&lang=tr&q=x+y%22%3E&empty='))

      expect(inputLines(html)).toEqual([
        '<input type="hidden" name="token" value="a+b=">',
        '<input type="hidden" name="lang" value="tr">',
        '<input type="hidden" name="q" value="x y&quot;&gt;">',
        '<input type="hidden" name="empty" value="">',
      ])
    })

    it('keeps the fragment of a GET URL in the action', () => {
      const html = render3DFormHtml(get({}, 'https://h/p?a=1#frag'))

      expect(html).toContain('action="https://h/p#frag"')
      expect(inputLines(html)).toEqual(['<input type="hidden" name="a" value="1">'])
    })

    it('drops an empty query of a GET URL', () => {
      const html = render3DFormHtml(get({ b: '2' }, 'https://h/p?'))

      expect(html).toContain('action="https://h/p"')
      expect(inputLines(html)).toEqual(['<input type="hidden" name="b" value="2">'])
    })

    it('refuses a GET input that repeats a query parameter', () => {
      expectPosError(() => render3DFormHtml(get({ a: '2' }, 'https://h/p?a=1')), /duplicate/)
    })

    it('refuses a GET URL whose query repeats a parameter', () => {
      expectPosError(() => render3DFormHtml(get({}, 'https://h/p?a=1&a=2')), /duplicate/)
    })

    // addition: D3 a query the hidden inputs cannot reproduce byte for byte is refused rather than altered
    it.each([
      ['a bare name', 'https://h/p?a'],
      ['a bare name after a pair', 'https://h/p?a=1&b'],
      ['an empty segment', 'https://h/p?a=1&&b=2'],
      ['a trailing separator', 'https://h/p?a=1&'],
      ['an invalid UTF-8 percent byte', 'https://h/p?a=%FF'],
      ['a truncated UTF-8 sequence', 'https://h/p?a=%C3'],
      ['a malformed percent escape', 'https://h/p?a=%zz'],
      ['a lone percent sign', 'https://h/p?a=50%'],
      ['a bad escape in a name', 'https://h/p?%E0%A4=1'],
    ])('refuses a GET URL with %s in its query', (_label, gateway) => {
      expectPosError(() => render3DFormHtml(get({}, gateway)), /query/)
    })

    it('accepts an empty value and percent-encoded UTF-8 in a GET query', () => {
      expect(inputLines(render3DFormHtml(get({}, 'https://h/p?a=&%C3%BC=%F0%9F%92%B3')))).toEqual([
        '<input type="hidden" name="a" value="">',
        '<input type="hidden" name="ü" value="💳">',
      ])
    })

    it('refuses a GET query parameter named _charset_', () => {
      expectPosError(() => render3DFormHtml(get({}, 'https://h/p?_CharSet_=x')), /_charset_/)
    })

    it('keeps the query of a POST URL in the action and adds no inputs from it', () => {
      const html = render3DFormHtml(post({ a: '2' }, 'https://h/p?a=1'))

      expect(html).toContain('action="https://h/p?a=1"')
      expect(inputLines(html)).toEqual(['<input type="hidden" name="a" value="2">'])
    })
  })

  describe('inputs', () => {
    it.each([[1], [null], [undefined], [true], [{}], [['x']], [Symbol('x')], [1n]])(
      'refuses a non-string value %s',
      (value) => {
        expectPosError(
          () => render3DFormHtml(post({ ok: '1', bad: value } as unknown as Record<string, string>)),
          /input "bad"/,
        )
      },
    )

    it.each([[null], [undefined], ['a=1'], [['a']], [1]])('refuses inputs that are not an object: %j', (inputs) => {
      expectPosError(
        () =>
          render3DFormHtml({ gateway: 'https://bank.example/3d', method: 'POST', inputs } as unknown as ThreeDFormData),
        /inputs/,
      )
    })

    it('ignores inherited and non-enumerable keys', () => {
      const inputs = Object.create({ inherited: 'x' }) as Record<string, string>
      inputs.own = '1'
      Object.defineProperty(inputs, 'hidden', { value: '2', enumerable: false })
      const html = render3DFormHtml(post(inputs))

      expect(inputLines(html)).toEqual(['<input type="hidden" name="own" value="1">'])
    })

    it('ignores symbol keys', () => {
      const inputs = { own: '1', [Symbol('s')]: '2' } as Record<string, string>

      expect(inputLines(render3DFormHtml(post(inputs)))).toEqual(['<input type="hidden" name="own" value="1">'])
    })

    it('reads a __proto__ input as an ordinary own key', () => {
      const inputs = JSON.parse('{"__proto__":"x","a":"1"}') as Record<string, string>

      expect(inputLines(render3DFormHtml(post(inputs)))).toEqual([
        '<input type="hidden" name="__proto__" value="x">',
        '<input type="hidden" name="a" value="1">',
      ])
    })

    it('refuses an empty input name (the browser would not send it)', () => {
      expectPosError(() => render3DFormHtml(post({ '': '1' })), /empty/)
    })

    // addition: D3 a browser replaces the value of a hidden input named _charset_ with the page encoding
    it.each([['_charset_'], ['_CHARSET_'], ['_Charset_']])('refuses an input named %s', (name) => {
      expectPosError(() => render3DFormHtml(post({ [name]: 'ISO-8859-9' })), /_charset_/)
    })

    it('accepts names that only contain _charset_', () => {
      expect(inputLines(render3DFormHtml(post({ x_charset_: '1', _charset: '2' })))).toEqual([
        '<input type="hidden" name="x_charset_" value="1">',
        '<input type="hidden" name="_charset" value="2">',
      ])
    })

    it.each([
      ['a lone high surrogate value', { a: 'x\uD800' }],
      ['a lone low surrogate name', { '\uDC00': '1' }],
      ['a NUL in a value', { a: 'x\u0000y' }],
      ['a NUL in a name', { 'a\u0000': '1' }],
    ])('refuses %s (the browser would not send it unchanged)', (_label, inputs) => {
      expectPosError(() => render3DFormHtml(post(inputs)), /cannot be sent unchanged/)
    })

    it('refuses an input whose own value comes from a getter that is not a string', () => {
      const inputs = { a: '1' } as Record<string, string>
      Object.defineProperty(inputs, 'b', { get: () => 2, enumerable: true })

      expectPosError(() => render3DFormHtml(post(inputs)), /input "b"/)
    })
  })

  describe('form', () => {
    it('refuses an HTML string (the bank page is served as it is, never wrapped)', () => {
      expectPosError(
        () => render3DFormHtml('<html><form action="https://bank.example"></form></html>' as unknown as ThreeDFormData),
        /HTML string/,
      )
    })

    it.each([[null], [undefined], [[]], [1]])('refuses %j', (form) => {
      expectPosError(() => render3DFormHtml(form as unknown as ThreeDFormData), /form/)
    })

    it('reads only own form fields', () => {
      const form = Object.create({ gateway: 'https://bank.example/3d', method: 'POST', inputs: {} }) as ThreeDFormData

      expectPosError(() => render3DFormHtml(form), /gateway/)
    })
  })

  describe('options', () => {
    it.each([
      ['x"><'],
      ['abc'],
      ['abcdefg'],
      ['a'.repeat(129)],
      ['abcdefgh "'],
      ['abcdefgh\n'],
      ["abcdefgh'"],
      ['abcdefgh;'],
      ['abcdéfgh'],
      [''],
    ])('refuses the nonce %j', (nonce) => {
      expectPosError(() => render3DFormHtml(post({}), { nonce }), /nonce/)
    })

    it.each([[1], [null], [{}], [true]])('refuses a non-string nonce %j', (nonce) => {
      expectPosError(() => render3DFormHtml(post({}), { nonce } as unknown as { nonce: string }), /nonce/)
    })

    it('accepts nonces of 8 and 128 characters from the allowed set', () => {
      expect(render3DFormHtml(post({}), { nonce: 'aZ09+/=_' })).toContain('<script nonce="aZ09+/=_">')
      const long = `${'A'.repeat(120)}-_+/=xyz`

      expect(render3DFormHtml(post({}), { nonce: long })).toContain(`<script nonce="${long}">`)
    })

    it.each([['false'], [0], [null], [1]])('refuses a non-boolean autoSubmit %j', (autoSubmit) => {
      expectPosError(
        () => render3DFormHtml(post({}), { autoSubmit } as unknown as { autoSubmit: boolean }),
        /autoSubmit/,
      )
    })

    it.each([['x'], [1], [[]]])('refuses options that are not an object: %j', (options) => {
      expectPosError(() => render3DFormHtml(post({}), options as unknown as { nonce: string }), /options/)
    })

    it('treats null options as no options', () => {
      expect(render3DFormHtml(post({}), null as unknown as undefined)).toBe(render3DFormHtml(post({})))
    })
  })

  // addition: D3 a form built by a gateway renders every input it holds, escaped, in its order
  it('renders the form of a gateway without card data when built without the card', async () => {
    const account = AccountFactory.createAssecoPosAccount('asseco', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200')
    const pos = PosFactory.createPosGateway(account, posTestConfig)
    const form = await pos.get3DFormData(
      {
        id: 'order-1',
        amount: 10.01,
        currency: 'TRY',
        installment: 0,
        success_url: 'https://shop.example/pos/callback?a=1&b=2',
        fail_url: 'https://shop.example/pos/callback?a=1&b=2',
      },
      MODEL.THREE_D_PAY_HOSTING,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )
    if (typeof form === 'string') {
      throw new PosError('expected a form object')
    }
    const html = render3DFormHtml(form)
    const escaped = (s: string) =>
      s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')

    expect(inputLines(html)).toEqual(
      Object.entries(form.inputs).map(
        ([name, value]) => `<input type="hidden" name="${escaped(name)}" value="${escaped(value)}">`,
      ),
    )
    expect(html).toContain('value="https://shop.example/pos/callback?a=1&amp;b=2"')
    expect(html).toContain(`action="${escaped(form.gateway)}"`)
  })
})
