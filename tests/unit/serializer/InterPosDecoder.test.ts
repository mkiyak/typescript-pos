import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { InterPosDecoder } from '../../../src/serializer/InterPosDecoder.js'
import { FULL_SUCCESS_RECORD, FULL_SUCCESS_RESPONSE } from './interPosFixtures.js'

describe('InterPosDecoder', () => {
  it('double_semicolon_delimiter', () => {
    const body = 'OrderId=33554969;;ProcReturnCode=00;;TxnResult=Success;;ErrorMessage='
    const actual = InterPosDecoder.decode(body)
    expect(actual).toStrictEqual({
      OrderId: '33554969',
      ProcReturnCode: '00',
      TxnResult: 'Success',
      ErrorMessage: '',
    })
    expect(Object.keys(actual)).toEqual(['OrderId', 'ProcReturnCode', 'TxnResult', 'ErrorMessage'])
  })

  it('triple_semicolon_delimiter', () => {
    expect(InterPosDecoder.decode('OrderId=12345;;;ProcReturnCode=00;;;TxnResult=Failed')).toStrictEqual({
      OrderId: '12345',
      ProcReturnCode: '00',
      TxnResult: 'Failed',
    })
  })

  it('value_containing_equals_sign', () => {
    expect(InterPosDecoder.decode('Key=val=ue;;Other=data')).toStrictEqual({ Key: 'val=ue', Other: 'data' })
  })

  it('full_success_payment_response', () => {
    const actual = InterPosDecoder.decode(FULL_SUCCESS_RESPONSE)
    expect(actual).toStrictEqual(FULL_SUCCESS_RECORD)
    expect(Object.keys(actual)).toEqual(Object.keys(FULL_SUCCESS_RECORD))
  })

  // deviation: a part without "=" is a PosHttpError (all failures are PosError subclasses)
  it('missing equals sign throws', () => {
    expect(() => InterPosDecoder.decode('key1Value;;key2Value')).toThrow(PosHttpError)
  })

  // addition: bodies that are not a record list never decode into something that looks like an answer
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['html page', '<html lang="tr"><body>Request Rejected</body></html>'],
    ['duplicate key', 'OrderId=1;;OrderId=2'],
    ['__proto__ key', '__proto__=x;;OrderId=1'],
    ['constructor key', 'constructor=x;;OrderId=1'],
    ['key with a space', 'Order Id=1'],
    ['empty key', '=x'],
    ['empty part between delimiters', 'a=1;;;;b=2'],
    ['trailing delimiter', 'a=1;;'],
  ])('rejects %s', (_name, body) => {
    expect(() => InterPosDecoder.decode(body)).toThrow(PosHttpError)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  // addition: a single ";" is part of the value
  it('keeps a single semicolon inside a value', () => {
    expect(InterPosDecoder.decode('Msg=a;b;;OrderId=1')).toStrictEqual({ Msg: 'a;b', OrderId: '1' })
  })

  // addition: the result has no inherited keys, so a polluted lookup cannot happen
  it('does not touch the prototype', () => {
    const actual = InterPosDecoder.decode('OrderId=1')
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).OrderId).toBeUndefined()
  })
})
