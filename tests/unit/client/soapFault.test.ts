import { describe, expect, it } from 'vitest'
import {
  FALLBACK_FAULT,
  FAULT_KEY,
  FAULT_PREFIX,
  FAULT_STRING_IN_TEXT,
  faultMessage,
  faultTextOf,
} from '../../../src/client/soapFault.js'

const PW = 'Test2'
const GUID = '0c13d406-873b-403b-9c09-a5766840d98c'

describe('soapFault', () => {
  // addition: shared SOAP fault helpers
  it('exposes the constants', () => {
    expect(FAULT_PREFIX).toBe('Bank SOAP fault: ')
    expect(FALLBACK_FAULT).toBe('Bank request failed')
    expect(FAULT_KEY.test('soap:Fault')).toBe(true)
    expect(FAULT_KEY.test('Fault')).toBe(true)
    expect(FAULT_KEY.test('Faulty')).toBe(false)
    expect(
      FAULT_STRING_IN_TEXT.exec('<faultcode>x</faultcode><faultstring xml:lang="en">boom</faultstring>')?.[1],
    ).toBe('boom')
  })

  it('masks the secrets it is given', () => {
    const out = faultMessage(`pw ${PW} ${GUID}`, [PW, GUID])
    expect(out).not.toContain(PW)
    expect(out).not.toContain(GUID)
    expect(out).toContain('***')
  })

  it('shortens to 256 characters by default and to the limit given', () => {
    expect(faultMessage('x'.repeat(300))).toHaveLength(256)
    expect(faultMessage('x'.repeat(300), [], 10)).toHaveLength(10)
  })

  it('decodes entities and removes control characters', () => {
    expect(faultMessage('&lt;b&gt; &amp; &#65;')).toBe('<b> & A')
    expect(faultMessage('a\u0000b\u001Fc\u007Fd')).toBe('a b c d')
  })

  it('masks bare base64 credential-like tokens and card-shaped digits', () => {
    const token = 'dGhpc2lzYXNlY3JldHNpZ25hdHVyZQ=='
    expect(faultMessage(`bad ${token} here`)).toBe('bad *** here')
    expect(faultMessage('card 5555444433332222 bad')).not.toContain('5555444433332222')
  })

  // addition: a short plain base64-looking word is not over-masked
  it('keeps ordinary words and short tokens', () => {
    expect(faultMessage('Invalid request for order order222')).toBe('Invalid request for order order222')
  })

  it('falls back when nothing readable is left', () => {
    expect(faultMessage('   ')).toBe(FALLBACK_FAULT)
  })

  it('reads the fault string of a parsed fault, plain or with attributes', () => {
    expect(faultTextOf({ faultstring: 'plain' })).toBe('plain')
    expect(faultTextOf({ 'soap:faultstring': { '@xml:lang': 'en', '#': 'with attr' } })).toBe('with attr')
    expect(faultTextOf({ faultcode: 'x' })).toBe(FALLBACK_FAULT)
  })
})
