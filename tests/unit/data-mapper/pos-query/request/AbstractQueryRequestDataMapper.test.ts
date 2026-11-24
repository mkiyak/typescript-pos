import { describe, expect, it } from 'vitest'
import { NullCrypt } from '../../../../../src/crypt/NullCrypt.js'
import { AbstractQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/AbstractQueryRequestDataMapper.js'
import { AssecoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AssecoPosAccount } from '../../../../../src/model/account/AssecoPosAccount.js'

// addition: query mapper bases are new in this version.
class TestRequestMapper extends AbstractQueryRequestDataMapper<AssecoPosAccount> {
  static supports(): boolean {
    return true
  }

  lang(params: Record<string, unknown>): string {
    return this.getLang(params)
  }

  merge(requestData: Record<string, unknown>, accountData: Record<string, string>): Record<string, unknown> {
    return this.mergeAccountData(requestData, accountData)
  }
}

const valueMapper = new AssecoPosRequestValueMapper()
const mapper = new TestRequestMapper(valueMapper, new AssecoPosRequestValueFormatter(), new NullCrypt())
const account = new AssecoPosAccount('bank', 'merchant', 'user', 'pass', 'key')

describe('AbstractQueryRequestDataMapper', () => {
  it('returns the custom query data as the same reference', () => {
    const data = { a: 1 }
    expect(mapper.createCustomQueryRequestData(account, data)).toBe(data)
  })

  it.each([
    ['history', (): unknown => mapper.createHistoryRequestData(account, {})],
    ['installment_rates', (): unknown => mapper.createInstallmentRatesRequestData(account, {})],
    ['installment_prices', (): unknown => mapper.createInstallmentPricesRequestData(account, {})],
    ['bin_list', (): unknown => mapper.createBinListRequestData(account, {})],
  ])('throws for unsupported %s', (type, fn) => {
    expect(fn).toThrow(UnsupportedTransactionTypeError)
    expect(fn).toThrow(`Query type [${type}] is not supported.`)
  })

  it('toggles test mode', () => {
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it('maps the language with a default', () => {
    expect(mapper.lang({})).toBe(valueMapper.mapLang('tr'))
    expect(mapper.lang({ lang: 'en' })).toBe(valueMapper.mapLang('en'))
  })

  it('merges account data without overwriting provided keys', () => {
    const input = { b: 1, Password: 'own', N: undefined, Z: null }
    const result = mapper.merge(input, { Password: 'p', N: 'n', Z: 'z', C: 'c' })
    expect(Object.keys(result)).toEqual(['b', 'Password', 'N', 'Z', 'C'])
    expect(result).toEqual({ b: 1, Password: 'own', N: 'n', Z: null, C: 'c' })
    expect(Object.keys(input)).toEqual(['b', 'Password', 'N', 'Z'])
    expect(input.N).toBeUndefined()
  })
})
