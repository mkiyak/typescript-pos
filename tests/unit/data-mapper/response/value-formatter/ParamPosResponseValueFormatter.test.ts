import { describe, expect, it } from 'vitest'
import { ParamPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

/** The wall-clock reading of an instant in Türkiye time. */
function turkeyWallClock(date: Date): string {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

describe('ParamPosResponseValueFormatter', () => {
  const formatter = new ParamPosResponseValueFormatter()

  it('supports', () => {
    expect(ParamPosResponseValueFormatter.supports('ParamPos')).toBe(true)
    expect(ParamPosResponseValueFormatter.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['1.01', '', 1.01],
    ['1.01', TX_TYPE.PAY_AUTH, 1.01],
    ['101', TX_TYPE.STATUS, 101],
  ])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it.each([
    ['1', TX_TYPE.PAY_AUTH, 0],
    ['1', '', 0],
    ['0', TX_TYPE.PAY_AUTH, 0],
    ['0', '', 0],
    [null, TX_TYPE.PAY_AUTH, 0],
    [null, '', 0],
  ])('formatInstallment(%j, %j) = %j', (installment, txType, expected) => {
    expect(formatter.formatInstallment(installment, txType)).toBe(expected)
  })

  // deviation: Türkiye time, the wall clock of the text is read as UTC+03:00
  it.each([
    ['TURKPOS_RETVAL_Islem_Tarih', '19.01.2025 18:53:48', '2025-01-19 18:53:48'],
    ['Tarih', '05.01.2025 13:14:32', '2025-01-05 13:14:32'],
  ])('formatDateTime %s', (_name, input, expected) => {
    expect(turkeyWallClock(formatter.formatDateTime(input, ''))).toBe(expected)
  })

  // addition: the bank prints single-digit days and months; the instant is the same as the padded text
  it.each([
    ['5.01.2025 14:52:20', '2025-01-05 14:52:20'],
    ['5.1.2025 14:52:20', '2025-01-05 14:52:20'],
    ['15.1.2025 14:52:20', '2025-01-15 14:52:20'],
    ['05.01.2025 14:52:20', '2025-01-05 14:52:20'],
  ])('formatDateTime(%j) reads one- and two-digit days and months', (input, expected) => {
    expect(turkeyWallClock(formatter.formatDateTime(input, ''))).toBe(expected)
  })

  // addition: history records carry an ISO time with an offset; the offset is honoured
  it('formatDateTime keeps an ISO time with an offset', () => {
    expect(formatter.formatDateTime('2025-01-20T09:12:38.94+03:00', '').toISOString()).toBe('2025-01-20T06:12:38.940Z')
  })

  // addition: impossible dates never roll over
  it.each(['32.01.2025 10:00:00', '31.02.2025 10:00:00', '5.13.2025 10:00:00', '5.1.25 10:00:00', 'abc'])(
    'formatDateTime(%j) is a PosError',
    (input) => {
      expect(() => formatter.formatDateTime(input, '')).toThrow(PosError)
    },
  )

  // addition: amounts are read from strict text; anything else is a PosError, never 0 or a prefix
  it.each([
    ['10,01', '', 10.01],
    ['10.0100', '', 10.01],
    ['0', '', 0],
    [101, '', 101],
  ])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it.each([
    ['', ''],
    ['abc', ''],
    ['1e3', ''],
    ['1,000.01', ''],
    ['10 ', ''],
    ['-1', ''],
    ['1.01abc', ''],
    ['10,01', TX_TYPE.STATUS],
    ['1.00001', TX_TYPE.STATUS],
    ['12345678901234', ''],
  ])('formatAmount(%j, %j) is a PosError', (amount, txType) => {
    expect(() => formatter.formatAmount(amount, txType)).toThrow(PosError)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('formatAmount(%j) is a PosError', (amount) => {
    expect(() => formatter.formatAmount(amount, '')).toThrow(PosError)
  })
})
