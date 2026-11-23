import { describe, expect, it } from 'vitest'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../../../../src/data-mapper/response/value-formatter/AbstractResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

/** Türkiye wall-clock time (UTC+03:00) as epoch ms. */
const tr = (y: number, mo: number, d: number, h: number, mi: number, s: number, ms = 0) =>
  Date.UTC(y, mo - 1, d, h - 3, mi, s, ms)

describe('BasicResponseValueFormatter', () => {
  const formatter = new BasicResponseValueFormatter()

  it('supports PayFlex/Akbank/PayFor gateways only', () => {
    expect(BasicResponseValueFormatter.supports('AkbankPos')).toBe(true)
    expect(BasicResponseValueFormatter.supports('PayFlexCPV4Pos')).toBe(true)
    expect(BasicResponseValueFormatter.supports('PayFlexV4Pos')).toBe(true)
    expect(BasicResponseValueFormatter.supports('PayForPos')).toBe(true)
    expect(BasicResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['1.00', TX_TYPE.PAY_AUTH, 1.0],
    ['1.00', '', 1.0],
    // PHP (float) cast edge cases
    ['12abc', '', 12],
    ['abc', '', 0],
    [' 2.5', '', 2.5],
    [3.25, '', 3.25],
  ])('formatAmount(%j, %j) === %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it.each([
    ['1', TX_TYPE.PAY_AUTH, 0],
    ['1', '', 0],
    ['0', TX_TYPE.PAY_AUTH, 0],
    ['0', '', 0],
    [null, TX_TYPE.PAY_AUTH, 0],
    [null, '', 0],
    // PHP (int) cast edge cases
    ['3', '', 3],
    ['12', '', 12],
    ['3abc', '', 3],
    ['abc', '', 0],
  ])('formatInstallment(%j, %j) === %j', (installment, txType, expected) => {
    expect(formatter.formatInstallment(installment, txType)).toBe(expected)
  })

  it('bank time zone is Türkiye, fixed UTC+03:00', () => {
    expect(BANK_TIMEZONE_OFFSET_MINUTES).toBe(180)
  })

  // Offset-less inputs are Türkiye time (UTC+03:00), independent of the server TZ.
  it.each([
    ['2024-04-23T16:14:00.264', tr(2024, 4, 23, 16, 14, 0, 264)],
    ['2022-10-30 12:29:53.773', tr(2022, 10, 30, 12, 29, 53, 773)],
    ['2024-06-03 16:06:29', tr(2024, 6, 3, 16, 6, 29)],
    ['2019-11-0813:58:37.909', tr(2019, 11, 8, 13, 58, 37, 909)],
    ['20221101 13:14:19', tr(2022, 11, 1, 13, 14, 19)],
    ['20230309221037', tr(2023, 3, 9, 22, 10, 37)],
    ['09.08.2024 10:40:34', tr(2024, 8, 9, 10, 40, 34)],
    ['2019-08-16T10:54:23.81069', tr(2019, 8, 16, 10, 54, 23, 810)],
    // explicit offsets are honoured exactly
    ['2024-07-01T13:15:47.2754872+03:00', Date.UTC(2024, 6, 1, 10, 15, 47, 275)],
    ['2024-07-01T13:15:47Z', Date.UTC(2024, 6, 1, 13, 15, 47)],
    ['2024-07-01T13:15:47-0500', Date.UTC(2024, 6, 1, 18, 15, 47)],
    // day rollover into UTC
    ['2024-01-01 01:30:00', Date.UTC(2023, 11, 31, 22, 30, 0)],
    // a US DST gap wall time is valid in Türkiye time
    ['2024-03-10 02:30:00', Date.UTC(2024, 2, 9, 23, 30, 0)],
  ])('formatDateTime(%j) -> %d', (input, expected) => {
    expect(formatter.formatDateTime(input, '').getTime()).toBe(expected)
  })

  it('formatDateTime("now") returns the current time', () => {
    const before = Date.now()
    const d = formatter.formatDateTime('now', '').getTime()
    expect(d).toBeGreaterThanOrEqual(before)
    expect(d).toBeLessThanOrEqual(Date.now())
  })

  it.each([['not a date'], ['2024-13-45 99:99:99'], ['2024-02-30 10:00:00'], ['2024-07-01T25:00:00+03:00']])(
    'formatDateTime(%j) throws PosError',
    (input) => {
      expect(() => formatter.formatDateTime(input, '')).toThrow(PosError)
      expect(() => formatter.formatDateTime(input, '')).toThrow(/Unsupported date time format/)
    },
  )
})
