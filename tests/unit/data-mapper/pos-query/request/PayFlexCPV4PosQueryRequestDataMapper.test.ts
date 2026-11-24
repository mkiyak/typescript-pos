import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PayFlexCPV4PosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PayFlexCPV4PosQueryRequestDataMapper.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { PayFlexPosAccount } from '../../../../../src/model/account/PayFlexPosAccount.js'

const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', '3XTgER89as', 'VP999999')

function create() {
  return new PayFlexCPV4PosQueryRequestDataMapper(
    new PayFlexCPV4PosRequestValueMapper(),
    new PayFlexCPV4PosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
  )
}

describe('PayFlexCPV4PosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PayFlexCPV4PosQueryRequestDataMapper.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testCreateCustomQueryRequestData', () => {
    expect(create().createCustomQueryRequestData(account, { OrderId: 'ORDER123' })).toEqual({
      HostMerchantId: '000000000111111',
      Password: '3XTgER89as',
      OrderId: 'ORDER123',
      // deviation: Q3 guide §6.5 - the query API also takes MerchantId, which the reference leaves out
      MerchantId: '1',
    })
  })

  it('testCreateCustomQueryRequestDataDoesNotOverwriteExistingFields', () => {
    const input = { HostMerchantId: 'CUSTOM', Password: 'CUSTOMPASS' }
    // deviation: Q3 guide §6.5 - MerchantId is added next to the caller's fields
    expect(create().createCustomQueryRequestData(account, input)).toEqual({ ...input, MerchantId: '1' })
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create().createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: sub-dealer MerchantId, Q5 order, no mutation
  it('uses the sub-merchant id of a sub-dealer account', () => {
    const sub = AccountFactory.createPayFlexPosAccount(
      'vakifbank-cp',
      '000000000111111',
      '3XTgER89as',
      'VP999999',
      PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
      '77',
    )
    expect(create().createCustomQueryRequestData(sub, { OrderId: 'O' }).MerchantId).toBe('77')
  })

  it('puts the caller keys first and does not mutate the input', () => {
    const input = { TransactionId: 'abc' }
    const out = create().createCustomQueryRequestData(account, input)
    expect(Object.keys(out)).toEqual(['TransactionId', 'HostMerchantId', 'MerchantId', 'Password'])
    expect(input).toEqual({ TransactionId: 'abc' })
  })
})
