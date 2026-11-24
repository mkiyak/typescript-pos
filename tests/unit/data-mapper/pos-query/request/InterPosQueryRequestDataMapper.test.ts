import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { InterPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/InterPosQueryRequestDataMapper.js'
import { InterPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { InterPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'

const account = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', 'gDg1N')

function create() {
  return new InterPosQueryRequestDataMapper(
    new InterPosRequestValueMapper(),
    new InterPosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
  )
}

describe('InterPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(InterPosQueryRequestDataMapper.supports('InterPos')).toBe(true)
    expect(InterPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it.each([
    [
      'without_account_data',
      { PurchAmount: '100', Currency: '949' },
      { UserCode: 'InterTestApi', UserPass: '3', ShopCode: '3123', PurchAmount: '100', Currency: '949' },
    ],
    [
      'with_account_data_already_set',
      { UserCode: 'CUSTOM', UserPass: 'CUSTOMPASS', ShopCode: 'CUSTOMSHOP', PurchAmount: '100', Currency: '949' },
      { UserCode: 'CUSTOM', UserPass: 'CUSTOMPASS', ShopCode: 'CUSTOMSHOP', PurchAmount: '100', Currency: '949' },
    ],
  ])('testCreateCustomQueryRequestData %s', (_name, input, expected) => {
    // the key order is not part of the contract for these rows
    expect(create().createCustomQueryRequestData(account, input)).toEqual(expected)
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create().createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: the caller's fields come first, the input is not mutated, a blank caller value wins
  it('puts the caller keys first, then the account fields', () => {
    const out = create().createCustomQueryRequestData(account, { TxnType: 'StatusHistory' })
    expect(Object.keys(out)).toEqual(['TxnType', 'UserCode', 'UserPass', 'ShopCode'])
  })

  it('never mutates the input', () => {
    const input = { TxnType: 'StatusHistory' }
    create().createCustomQueryRequestData(account, input)
    expect(input).toEqual({ TxnType: 'StatusHistory' })
  })

  it('keeps an empty ShopCode the caller set', () => {
    expect(create().createCustomQueryRequestData(account, { ShopCode: '' }).ShopCode).toBe('')
  })
})
