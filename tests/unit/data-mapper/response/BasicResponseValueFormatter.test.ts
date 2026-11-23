import { describe, expect, it } from 'vitest'
import { BasicResponseValueFormatter } from '../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { TX_TYPE } from '../../../../src/PosInterface.js'

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

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

  it.each([
    ['2024-04-23T16:14:00.264', '2024-04-23 16:14:00'],
    ['2022-10-30 12:29:53.773', '2022-10-30 12:29:53'],
    ['2024-06-03 16:06:29', '2024-06-03 16:06:29'],
    ['2019-11-0813:58:37.909', '2019-11-08 13:58:37'],
    ['20221101 13:14:19', '2022-11-01 13:14:19'],
    ['20230309221037', '2023-03-09 22:10:37'],
    ['09.08.2024 10:40:34', '2024-08-09 10:40:34'],
    ['2019-08-16T10:54:23.81069', '2019-08-16 10:54:23'],
    ['2024-07-01T13:15:47.2754872+03:00', '2024-07-01 13:15:47'],
  ])('formatDateTime(%j) -> %j', (input, expected) => {
    expect(fmt(formatter.formatDateTime(input, ''))).toBe(expected)
  })

  it('keeps milliseconds', () => {
    expect(formatter.formatDateTime('2022-10-30 12:29:53.773', '').getMilliseconds()).toBe(773)
  })

  it('formatDateTime("now") returns the current time', () => {
    const before = Date.now()
    const d = formatter.formatDateTime('now', '').getTime()
    expect(d).toBeGreaterThanOrEqual(before)
    expect(d).toBeLessThanOrEqual(Date.now())
  })

  it('formatDateTime throws on unparseable input', () => {
    expect(() => formatter.formatDateTime('not a date', '')).toThrow(/Unsupported date time format/)
    expect(() => formatter.formatDateTime('2024-13-45 99:99:99', '')).toThrow(/Unsupported date time format/)
  })
})
