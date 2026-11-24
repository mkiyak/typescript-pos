import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'

const account = AccountFactory.createPayFlexPosAccount('payflex-mpi-v4', '000000000111111', '3XTgER89as', '3XTgER89as')

function create() {
  return new PayFlexV4PosQueryRequestDataMapper(
    new PayFlexV4PosRequestValueMapper(),
    new PayFlexV4PosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
  )
}

describe('PayFlexV4PosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PayFlexV4PosQueryRequestDataMapper.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testCreateCustomQueryRequestData', () => {
    expect(
      create().createCustomQueryRequestData(account, { TransactionDate: '2024-01-01', OrderId: 'ORDER123' }),
    ).toEqual({
      MerchantId: '000000000111111',
      Password: '3XTgER89as',
      TerminalNo: '3XTgER89as',
      TransactionDate: '2024-01-01',
      OrderId: 'ORDER123',
    })
  })

  it('testCreateCustomQueryRequestDataDoesNotOverwriteExistingFields', () => {
    const input = { MerchantId: 'CUSTOM_MERCHANT', Password: 'CUSTOM_PASS', TerminalNo: 'CUSTOM_TERMINAL' }
    expect(create().createCustomQueryRequestData(account, input)).toEqual(input)
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create().createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: Q5 order, no mutation
  it('puts the caller keys first and does not mutate the input', () => {
    const input = { OrderId: 'ORDER123' }
    const out = create().createCustomQueryRequestData(account, input)
    expect(Object.keys(out)).toEqual(['OrderId', 'MerchantId', 'Password', 'TerminalNo'])
    expect(input).toEqual({ OrderId: 'ORDER123' })
  })
})
