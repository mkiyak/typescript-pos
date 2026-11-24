import { describe, expect, it } from 'vitest'
import { PosNetPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'

describe('PosNetPosResponseValueFormatter', () => {
  const formatter = new PosNetPosResponseValueFormatter()

  it('supports', () => {
    expect(PosNetPosResponseValueFormatter.supports('PosNetPos')).toBe(true)
    expect(PosNetPosResponseValueFormatter.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['101', '', 1.01],
    ['10,1', 'status', 10.1],
    ['1.056,2', 'status', 1056.2],
  ])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: minor units, numbers and empty values
  it('formatAmount reads minor units outside status', () => {
    expect(formatter.formatAmount(5696, 'pay')).toBe(56.96)
    expect(formatter.formatAmount('', 'pay')).toBe(0)
  })

  // addition: installment and timestamp layouts
  it('formatInstallment', () => {
    expect(formatter.formatInstallment('00', 'pay')).toBe(0)
    expect(formatter.formatInstallment('02', 'pay')).toBe(2)
  })

  it('formatDateTime reads offsetless times as Turkish time', () => {
    expect(formatter.formatDateTime('2019-10-10 11:21:14.281', 'status')).toEqual(
      new Date('2019-10-10T11:21:14.281+03:00'),
    )
    expect(formatter.formatDateTime('2019-11-0813:58:37.909', 'status')).toEqual(
      new Date('2019-11-08T13:58:37.909+03:00'),
    )
  })
})
