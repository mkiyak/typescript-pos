import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PosNetPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PosNetPosQueryRequestDataMapper.js'
import { PosNetPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'

const account = AccountFactory.createPosNetPosAccount(
  'yapikredi',
  '6706598320',
  '67005551',
  '27426',
  '10,10,10,10,10,10,10,10',
)

function create() {
  return new PosNetPosQueryRequestDataMapper(
    new PosNetPosRequestValueMapper(),
    new PosNetPosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
  )
}

describe('PosNetPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PosNetPosQueryRequestDataMapper.supports('PosNetPos')).toBe(true)
    expect(PosNetPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testCreateCustomQueryRequestData', () => {
    const actual = create().createCustomQueryRequestData(account, { amount: '1000' })
    expect(actual.mid).toBe('6706598320')
    expect(actual.tid).toBe('67005551')
    expect(actual.amount).toBe('1000')
  })

  it('testCreateCustomQueryRequestDataDoesNotOverwriteExistingFields', () => {
    const actual = create().createCustomQueryRequestData(account, { mid: 'CUSTOMMID', tid: 'CUSTOMTID' })
    expect(actual.mid).toBe('CUSTOMMID')
    expect(actual.tid).toBe('CUSTOMTID')
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create().createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: the caller's object is not modified and the credentials come after the caller's own fields
  it('does not mutate the caller data', () => {
    const input = { pointUsage: { amount: '250' } }
    const actual = create().createCustomQueryRequestData(account, input)
    expect(input).toEqual({ pointUsage: { amount: '250' } })
    expect(Object.keys(actual)).toEqual(['pointUsage', 'mid', 'tid'])
  })
})
