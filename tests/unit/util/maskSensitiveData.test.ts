import { describe, expect, it } from 'vitest'
import { maskSensitiveData } from '../../../src/util/maskSensitiveData.js'

describe('maskSensitiveData', () => {
  it('masks sensitive keys deeply and case-insensitively', () => {
    const keys = [
      'pan',
      'number',
      'cardnumber',
      'card_number',
      'cv2',
      'cvv',
      'cvc',
      'expiry',
      'expirydate',
      'exp_year',
      'exp_month',
      'ecom_payment_card_expdate_year',
      'ecom_payment_card_expdate_month',
      'password',
      'merchantpassword',
      'storekey',
      'secret_key',
      'store_key',
      'cvv2val',
      'expires',
      'secretKey',
      'terminalId',
      'username',
    ]
    for (const key of keys) {
      const out = maskSensitiveData({ a: { b: [{ [key.toUpperCase()]: 'secretvalue' }] }, [key]: 'x' }) as unknown as {
        a: { b: Record<string, unknown>[] }
      } & Record<string, unknown>
      expect(out.a.b[0]?.[key.toUpperCase()]).not.toBe('secretvalue')
      expect(out[key]).not.toBe('x')
      expect(JSON.stringify(out)).not.toContain('secretvalue')
    }
  })

  it('masks PAN-shaped numbers inside strings as first6****last4', () => {
    expect(maskSensitiveData('card 4111111111111111 used')).toBe('card 411111****1111 used')
    expect(maskSensitiveData({ msg: '<Number>5555555555554444</Number>' })).toEqual({
      msg: '<Number>555555****4444</Number>',
    })
  })

  it('leaves non-sensitive data untouched', () => {
    const data = { order_id: 'ABC123', amount: 10.5, ok: true, nothing: null, list: [1, 'a'] }
    expect(maskSensitiveData(data)).toEqual(data)
    expect(maskSensitiveData('short 123456789012')).toBe('short 123456789012')
  })

  it('does not mutate input', () => {
    const data = { pan: '4111111111111111', nested: { cvv: '123' } }
    const copy = structuredClone(data)
    maskSensitiveData(data)
    expect(data).toEqual(copy)
  })

  it('handles circular references and Error values', () => {
    const a: Record<string, unknown> = { x: 1 }
    a.self = a
    expect(() => maskSensitiveData(a)).not.toThrow()
    expect(maskSensitiveData(new Error('pan 4111111111111111'))).toBeDefined()
  })

  it('masks sensitive values inside XML bodies', () => {
    const xml =
      '<Request><Cvv2Val>123</Cvv2Val><Expires>12/30</Expires><Password>pw</Password><Pan>4111111111111111</Pan>' +
      '<MerchantPassword >x</MerchantPassword><Cvv>999</Cvv><Expiry>1230</Expiry><ExpiryDate>1230</ExpiryDate><Name>Ali</Name></Request>'
    const out = maskSensitiveData(xml)
    expect(out).toBe(
      '<Request><Cvv2Val>***</Cvv2Val><Expires>***</Expires><Password>***</Password><Pan>***</Pan>' +
        '<MerchantPassword >***</MerchantPassword><Cvv>***</Cvv><Expiry>***</Expiry><ExpiryDate>***</ExpiryDate><Name>Ali</Name></Request>',
    )
  })

  it('masks sensitive values inside urlencoded bodies', () => {
    const body = 'cv2=123&CVV=456&Cvv2Val=789&expires=1230&PASSWORD=p&MerchantPassword=q&pan=4111111111111111&oid=A1'
    expect(maskSensitiveData(body)).toBe(
      'cv2=***&CVV=***&Cvv2Val=***&expires=***&PASSWORD=***&MerchantPassword=***&pan=***&oid=A1',
    )
  })

  it('masks class instances by walking own properties', () => {
    class CreditCard {
      pan = '4111111111111111'
      cvv = '123'
      holder = 'Ali'
    }
    expect(maskSensitiveData(new CreditCard())).toEqual({ pan: '***', cvv: '***', holder: 'Ali' })
  })

  it('replaces exotic objects with placeholders', () => {
    expect(maskSensitiveData(new Map([['pan', '4111111111111111']]))).toBe('[Map]')
    expect(maskSensitiveData(new URLSearchParams('cvv=123'))).toBe('[URLSearchParams]')
    expect(maskSensitiveData(Buffer.from('4111111111111111'))).toBe('[Uint8Array]')
    expect(maskSensitiveData({ b: Buffer.from('x') })).toEqual({ b: '[Uint8Array]' })
  })

  it('masks 13-19 digit numeric values and exact PAN shapes', () => {
    expect(maskSensitiveData({ n: 4111111111111111n })).toEqual({ n: '411111****1111' })
    expect(maskSensitiveData({ n: 4111111111111 })).toEqual({ n: '411111****1111' })
    expect(maskSensitiveData('id_4111111111111111x 12345678901234567890')).toBe(
      'id_411111****1111x 12345678901234567890',
    )
    expect(maskSensitiveData({ n: 12345 })).toEqual({ n: 12345 })
  })

  it('caps nesting depth', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 20000; i++) deep = { n: deep }
    expect(() => maskSensitiveData(deep)).not.toThrow()
  })

  // addition: expiry object keys
  it('masks ExpireMonth and ExpireYear keys', () => {
    expect(maskSensitiveData({ ExpireMonth: '12', expireYear: '2021' })).toEqual({
      ExpireMonth: '***',
      expireYear: '***',
    })
  })

  // addition: query-string card fields
  it('masks card fields in query strings', () => {
    const out = maskSensitiveData('PAN=5555444433332222&CVV=122&ExpireMonth=12&ExpireYear=2021&MerchantPassword=x')
    for (const leak of ['5555444433332222', '=122', '=12&', '=2021', '=x']) {
      expect(out).not.toContain(leak)
    }
  })

  // addition: JSON-encoded secrets inside strings
  it('masks JSON-in-string secrets and keeps other pairs', () => {
    const out = maskSensitiveData('{"HostMerchantId":"000000000111111","Password":"3XTgER89as","TransactionId":"abc"}')
    expect(out).toContain('"Password":"***"')
    expect(out).toContain('"TransactionId":"abc"')
    expect(out).not.toContain('3XTgER89as')
    expect(maskSensitiveData('{"Password" : "a\\"b"}')).toBe('{"Password":"***"}')
  })

  // addition: card fields of XML requests and 3D forms
  it('masks expiry, CVV2 and refund password', () => {
    const out = maskSensitiveData({
      Card: { Number: '5555444433332222', ExpireDate: '0122', CVV2: '123' },
      refundPassword: 'r',
    })
    expect(out.Card.Number).toBe('***')
    expect(out.Card.ExpireDate).toBe('***')
    expect(out.Card.CVV2).toBe('***')
    expect(out.refundPassword).toBe('***')

    const xml = maskSensitiveData(
      '<Card><Number>5555444433332222</Number><ExpireDate>0122</ExpireDate><CVV2>123</CVV2></Card>',
    )
    expect(xml).toContain('<ExpireDate>***</ExpireDate>')
    expect(xml).toContain('<CVV2>***</CVV2>')
    expect(xml).toContain('555544****2222')

    const form = maskSensitiveData(
      'cardnumber=5555444433332222&cardexpiredatemonth=01&cardexpiredateyear=22&cardcvv2=123',
    )
    expect(form).toContain('cardexpiredatemonth=***')
    expect(form).toContain('cardexpiredateyear=***')
    expect(form).toContain('cardcvv2=***')
  })

  // addition: JSON API field names, auth header and numeric JSON values
  it('masks the JSON API card, header and secret fields', () => {
    expect(
      maskSensitiveData({ creditCard: '4355093000315232', expiredDate: '1135', cvv: '665', 'auth-hash': 'abc' }),
    ).toEqual({ creditCard: '***', expiredDate: '***', cvv: '***', 'auth-hash': '***' })

    const json = maskSensitiveData(
      '{"card":{"cardNumber":"4355093000315232","cvv2":123,"expireDate":"1135"},"secretKey":"s3"}',
    )
    expect(json).toContain('"cvv2":"***"')
    expect(json).toContain('"expireDate":"***"')
    expect(json).toContain('"secretKey":"***"')
    expect(json).toContain('435509****5232')
    expect(json).not.toContain('123')
    expect(json).not.toContain('s3')

    const form = maskSensitiveData('creditCard=4355093000315232&expiredDate=1135&cvv=665')
    expect(form).toContain('creditCard=***')
    expect(form).toContain('expiredDate=***')
    expect(form).toContain('cvv=***')
  })

  // addition: F6 a string body echoing the request header
  it('masks an auth-hash value inside a string body', () => {
    const body = maskSensitiveData('{"auth-hash":"c2VjcmV0U2lnbmF0dXJl","other":"x"}')
    expect(body).toContain('"auth-hash":"***"')
    expect(body).not.toContain('c2VjcmV0U2lnbmF0dXJl')
    expect(body).toContain('"other":"x"')
  })

  // addition: card and MAC fields of the POSNET and JSON card APIs
  it('masks card, enc key and MAC keys', () => {
    const out = maskSensitiveData({
      ccno: '5555444433332222',
      expDate: '2201',
      cvc: '123',
      Cvc2: '056',
      CardNo: '5400619360964581',
      ExpiredDate: '2001',
      encKey: 'k',
      mac: 'm',
      Mac: 'm',
      MAC: 'm',
    })
    for (const value of Object.values(out)) expect(value).toBe('***')
  })

  it('masks POSNET XML card fields and MAC', () => {
    const out = maskSensitiveData(
      'xmldata=<?xml version="1.0"?>\n<posnetRequest><oosRequestData><ccno>5555444433332222</ccno><expDate>2201</expDate><cvc>123</cvc></oosRequestData><mac>abc=</mac></posnetRequest>',
    )
    expect(out).toContain('<ccno>***</ccno>')
    expect(out).toContain('<expDate>***</expDate>')
    expect(out).toContain('<cvc>***</cvc>')
    expect(out).toContain('<mac>***</mac>')
    expect(out).not.toContain('5555444433332222')
    expect(out).not.toContain('abc=')
  })

  it('masks JSON card fields and MAC', () => {
    const out = maskSensitiveData(
      '{"CardInformationData":{"CardNo":"5400619360964581","Cvc2":"056","ExpireDate":"2001"},"MAC":"x"}',
    )
    expect(out).toContain('"CardNo":"***"')
    expect(out).toContain('"Cvc2":"***"')
    expect(out).toContain('"ExpireDate":"***"')
    expect(out).toContain('"MAC":"***"')
  })

  it('leaves MacParams values readable', () => {
    expect(maskSensitiveData({ MacParams: 'MerchantNo:TerminalNo' })).toEqual({ MacParams: 'MerchantNo:TerminalNo' })
  })

  // addition: F23
  it('masks PayFor password keys and card fields in objects', () => {
    const out = maskSensitiveData({
      UserPass: 'UcBN0',
      MerchantPass: 'x',
      Pan: '4155650100416111',
      Expiry: '0128',
      Cvv2: '123',
    })
    for (const value of Object.values(out)) expect(value).toBe('***')
  })

  // addition: F23
  it('masks PayFor XML request fields', () => {
    const out = maskSensitiveData(
      '<PayforRequest><UserCode>u</UserCode><UserPass>UcBN0</UserPass><Pan>4155650100416111</Pan><Cvv2>123</Cvv2><Expiry>0128</Expiry></PayforRequest>',
    )
    expect(out).toContain('<UserPass>***</UserPass>')
    expect(out).toContain('<Pan>***</Pan>')
    expect(out).toContain('<Cvv2>***</Cvv2>')
    expect(out).toContain('<Expiry>***</Expiry>')
    expect(out).toContain('<UserCode>u</UserCode>')
    expect(out).not.toContain('UcBN0')
  })

  // addition: F23
  it('masks PayFor form fields and keeps the hash readable', () => {
    const out = maskSensitiveData('MbrId=5&UserCode=u&Pan=4155650100416111&Expiry=0128&Cvv2=123&Hash=abc')
    expect(out).toContain('Pan=***')
    expect(out).toContain('Expiry=***')
    expect(out).toContain('Cvv2=***')
    expect(out).toContain('Hash=abc')
    expect(out).not.toContain('4155650100416111')
  })

  // addition: F26
  it('masks the CAVV and the InterPos card fields in objects', () => {
    const out = maskSensitiveData({
      PayerAuthenticationCode: 'AAABBJkZUQAAAAAAAAAAAAAAAAA=',
      UserPass: '3',
      Pan: '5555444433332222',
      Expiry: '1221',
      Cvv2: '122',
    })
    for (const value of Object.values(out)) expect(value).toBe('***')
  })

  // addition: F26
  it('masks InterPos form fields and keeps the identifiers and the hash readable', () => {
    const out = maskSensitiveData(
      'ShopCode=3123&UserCode=InterTestApi&UserPass=3&Pan=5555444433332222&Expiry=1221&Cvv2=122&PayerAuthenticationCode=AAAB%3D&Hash=abc',
    )
    for (const name of ['UserPass', 'Pan', 'Expiry', 'Cvv2', 'PayerAuthenticationCode']) {
      expect(out).toContain(`${name}=***`)
    }
    expect(out).toContain('ShopCode=3123')
    expect(out).toContain('UserCode=InterTestApi')
    expect(out).toContain('Hash=abc')
    expect(out).not.toContain('5555444433332222')
    expect(out).not.toContain('AAAB')
  })

  // addition: F26
  it('never shows a full card number in a ;; separated bank body', () => {
    const out = maskSensitiveData('OrderId=1;;Pan=5400615555550430;;ProcReturnCode=00;;Cardno=5400615555550430')
    expect(out).not.toMatch(/\d{16}/)
    expect(maskSensitiveData('OrderId=1;;Pan=540061******0430;;ProcReturnCode=00')).not.toMatch(/\d{16}/)
  })
  // addition: B11 the hashed password is the effective signing secret of the BOA banks
  it('masks HashPassword in objects, XML and form text and keeps MerchantId', () => {
    expect(maskSensitiveData({ HashPassword: 'h58bUB83xQz2/21SUeOemUgkF5U=' })).toStrictEqual({ HashPassword: '***' })
    expect(maskSensitiveData({ hashpassword: 'x', MerchantId: '1' })).toStrictEqual({
      hashpassword: '***',
      MerchantId: '1',
    })
    const xml = maskSensitiveData(
      '<VPosMessage><MerchantId>80</MerchantId><HashPassword>c77dFssAnYSy6O2MJo+5tMYtGVc=</HashPassword></VPosMessage>',
    )
    expect(xml).toContain('<HashPassword>***</HashPassword>')
    expect(xml).toContain('<MerchantId>80</MerchantId>')
    expect(xml).not.toContain('c77dFss')
    const form = maskSensitiveData('HashPassword=c77dFssAnYSy6O2MJo%2B5tMYtGVc%3D&MerchantId=1')
    expect(form).toBe('HashPassword=***&MerchantId=1')
    const json = maskSensitiveData('{"HashPassword":"c77dFssAnYSy6O2MJo+5tMYtGVc=","MerchantId":"1"}')
    expect(json).not.toContain('c77dFss')
    expect(json).toContain('"MerchantId":"1"')
  })
})
