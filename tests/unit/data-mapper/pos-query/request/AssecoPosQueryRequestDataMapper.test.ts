import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { AssecoPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import { AssecoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'

const account = AccountFactory.createAssecoPosAccount('payten_v3_hash', '190100000', 'ZIRAATAPI', 'ZIRAAT19', '123456')

function create() {
  return new AssecoPosQueryRequestDataMapper(
    new AssecoPosRequestValueMapper(),
    new AssecoPosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
  )
}

const credentials = { Name: 'ZIRAATAPI', Password: 'ZIRAAT19', ClientId: '190100000' }
const query = { Type: 'Query', Number: '4111111111111111', Expires: '10.2025', Extra: { IMECECARDQUERY: null } }

describe('AssecoPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(AssecoPosQueryRequestDataMapper.supports('AssecoPos')).toBe(true)
    expect(AssecoPosQueryRequestDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it.each([
    ['without_account_data', query, { ...credentials, ...query }],
    [
      'with_account_data_already_set',
      { Name: 'CUSTOMNAME', Password: 'CUSTOMPASS', ClientId: 'CUSTOMCLIENT', ...query },
      { Name: 'CUSTOMNAME', Password: 'CUSTOMPASS', ClientId: 'CUSTOMCLIENT', ...query },
    ],
  ])('testCreateCustomQueryRequestData %s', (_name, input, expected) => {
    // the reference sorts keys; the order is not part of the contract for these rows
    expect(create().createCustomQueryRequestData(account, input)).toEqual(expected)
  })

  it.each([
    [
      'testCreateHistoryRequestDataThrows',
      (m: AssecoPosQueryRequestDataMapper) => m.createHistoryRequestData(account, {}),
    ],
    [
      'testCreateInstallmentRatesRequestDataThrows',
      (m: AssecoPosQueryRequestDataMapper) => m.createInstallmentRatesRequestData(account, {}),
    ],
    [
      'testCreateInstallmentPricesRequestDataThrows',
      (m: AssecoPosQueryRequestDataMapper) => m.createInstallmentPricesRequestData(account, {}),
    ],
    [
      'testCreateBinListRequestDataThrows',
      (m: AssecoPosQueryRequestDataMapper) => m.createBinListRequestData(account, {}),
    ],
  ])('%s', (_name, call) => {
    expect(() => call(create())).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: Q5 key order, undefined/null handling, no mutation
  it('puts the caller keys first, then the credentials', () => {
    const out = create().createCustomQueryRequestData(account, query)
    expect(Object.keys(out)).toEqual(['Type', 'Number', 'Expires', 'Extra', 'Name', 'Password', 'ClientId'])
  })

  it('fills an undefined credential and keeps a null one', () => {
    const mapper = create()
    expect(mapper.createCustomQueryRequestData(account, { Password: undefined, A: 1 })).toEqual({
      Password: 'ZIRAAT19',
      A: 1,
      Name: 'ZIRAATAPI',
      ClientId: '190100000',
    })
    expect(mapper.createCustomQueryRequestData(account, { Password: null }).Password).toBeNull()
  })

  it('never mutates the input', () => {
    const input = { Type: 'Query' }
    create().createCustomQueryRequestData(account, input)
    expect(input).toEqual({ Type: 'Query' })
  })
})
