import { describe, expect, it } from 'vitest'
import { FormEncoder } from '../../../src/serializer/FormEncoder.js'

describe('FormEncoder', () => {
  it.each([
    ['simple_key_value', { abc: '1', abc2: 1.0, sa: 'aa' }, 'abc=1&abc2=1&sa=aa'],
    [
      'interpos_style',
      { UserCode: 'QNB_API_KULLANICI_3DPAY', OrderId: 'order222', Amount: '100.25' },
      'UserCode=QNB_API_KULLANICI_3DPAY&OrderId=order222&Amount=100.25',
    ],
    ['cancel_request', { key: 'value' }, 'key=value'],
    ['values_with_spaces_are_url_encoded', { key: 'hello world' }, 'key=hello+world'],
  ])('encodes %s', (_name, input, expected) => {
    expect(FormEncoder.encode(input)).toBe(expected)
  })

  // Expected values confirmed with PHP builtin http_build_query().
  it('follows http_build_query semantics for nested data, Turkish chars, null and booleans', () => {
    expect(FormEncoder.encode({ a: { b: 'c', d: ['x', 'y'] } })).toBe('a%5Bb%5D=c&a%5Bd%5D%5B0%5D=x&a%5Bd%5D%5B1%5D=y')
    expect(FormEncoder.encode({ n: 'İşbank Ödeme ĞÜŞ' })).toBe('n=%C4%B0%C5%9Fbank+%C3%96deme+%C4%9E%C3%9C%C5%9E')
    expect(FormEncoder.encode({ a: null, b: undefined, c: true, d: false, e: '' })).toBe('c=1&d=0&e=')
    expect(FormEncoder.encode({ s: "a&b=c~d*e'f(g)!" })).toBe('s=a%26b%3Dc%7Ed%2Ae%27f%28g%29%21')
  })
})
