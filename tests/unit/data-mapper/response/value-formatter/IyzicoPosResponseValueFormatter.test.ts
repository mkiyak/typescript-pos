import { describe, expect, it } from 'vitest'
import { IyzicoPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('IyzicoPosResponseValueFormatter', () => {
  const formatter = new IyzicoPosResponseValueFormatter()

  it('supports', () => {
    expect(IyzicoPosResponseValueFormatter.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosResponseValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    // deviation: Türkiye time — a time without an offset is UTC+03:00, not the server zone
    ['2026-06-11 23:17:51', QUERY_TYPE.HISTORY, new Date('2026-06-11T23:17:51+03:00')],
    ['2026-06-11 23:29:31', TX_TYPE.ORDER_HISTORY, new Date('2026-06-11T23:29:31+03:00')],
    ['1781209772355', TX_TYPE.PAY_AUTH, new Date(1781209772000)],
    ['1781209772000', TX_TYPE.STATUS, new Date(1781209772000)],
    // addition: an offset is kept
    ['2026-06-11T23:29:31Z', TX_TYPE.ORDER_HISTORY, new Date('2026-06-11T23:29:31Z')],
  ])('formatDateTime(%j, %j)', (text, txType, expected) => {
    expect(formatter.formatDateTime(text, txType)).toEqual(expected)
  })

  it.each([['x'], ['-5'], ['12.5'], ['']])('formatDateTime(%j) epoch is unreadable', (text) => {
    expect(() => formatter.formatDateTime(text, TX_TYPE.PAY_AUTH)).toThrow(PosError)
  })

  it('formatDateTime rejects an unreadable reporting time', () => {
    expect(() => formatter.formatDateTime('x', TX_TYPE.ORDER_HISTORY)).toThrow(PosError)
  })

  it.each([
    [null, 0],
    ['1', 0],
    ['2', 2],
    ['0', 0],
  ])('formatInstallment(%j) -> %j', (raw, expected) => {
    expect(formatter.formatInstallment(raw, TX_TYPE.PAY_AUTH)).toBe(expected)
  })

  it.each([
    ['10.01', 10.01],
    ['100', 100],
    // addition: numbers pass through
    [10.209999999999999, 10.209999999999999],
  ])('formatAmount(%j) -> %j', (raw, expected) => {
    expect(formatter.formatAmount(raw, TX_TYPE.PAY_AUTH)).toBe(expected)
  })

  it.each([['abc'], [''], ['-1'], ['1e3'], [Number.NaN], [-1], [Number.POSITIVE_INFINITY], [1e13], [1e20]])(
    'formatAmount(%j) is unreadable',
    (raw) => {
      expect(() => formatter.formatAmount(raw as string | number, TX_TYPE.PAY_AUTH)).toThrow(PosError)
    },
  )
})
