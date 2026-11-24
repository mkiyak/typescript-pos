import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PosNetV1PosCrypt } from '../../../../../src/crypt/PosNetV1PosCrypt.js'
import { PosNetV1PosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PosNetV1PosQueryRequestDataMapper.js'
import { PosNetV1PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { PosNetV1PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { noopLogger } from '../../../../../src/logger.js'

const KEY = '10,10,10,10,10,10,10,10'
const account = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010028724242434', KEY)

function create(crypt: unknown) {
  return new PosNetV1PosQueryRequestDataMapper(
    new PosNetV1PosRequestValueMapper(),
    new PosNetV1PosRequestValueFormatter(),
    crypt as never,
  )
}

function stub() {
  const hashFromParams = vi.fn((..._a: unknown[]) => 'generated_mac')
  return { crypt: { hashFromParams }, hashFromParams }
}

describe('PosNetV1PosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PosNetV1PosQueryRequestDataMapper.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testCreateCustomQueryRequestDataWithMACParams', () => {
    const { crypt, hashFromParams } = stub()
    const actual = create(crypt).createCustomQueryRequestData(account, {
      TranType: 'Sale',
      MACParams: 'MerchantNo:TerminalNo:TranType',
    })
    expect(hashFromParams).toHaveBeenCalledTimes(1)
    expect(actual.ApiType).toBe('JSON')
    expect(actual.ApiVersion).toBe('V100')
    expect(actual.MerchantNo).toBe('6700950031')
    expect(actual.TerminalNo).toBe('67540050')
    expect(actual.MAC).toBe('generated_mac')
    expect(actual.TranType).toBe('Sale')
  })

  it('testCreateCustomQueryRequestDataWithPresetMAC', () => {
    const { crypt, hashFromParams } = stub()
    const actual = create(crypt).createCustomQueryRequestData(account, {
      MACParams: 'MerchantNo:TerminalNo',
      MAC: 'pre_set_mac',
    })
    expect(hashFromParams).not.toHaveBeenCalled()
    expect(actual.MAC).toBe('pre_set_mac')
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create(stub().crypt).createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: a request without a MAC must name the signed fields; nothing is signed over an unknown list
  it.each([
    ['absent', {}],
    ['empty', { MACParams: '' }],
    ['a number', { MACParams: 1 }],
    ['undefined', { MACParams: undefined }],
  ])('rejects MACParams that is %s', (_name, extra) => {
    const { crypt, hashFromParams } = stub()
    expect(() => create(crypt).createCustomQueryRequestData(account, { TranType: 'Sale', ...extra })).toThrow(PosError)
    expect(hashFromParams).not.toHaveBeenCalled()
  })

  // addition: MAC computed by the real crypt equals an independent SHA-256 recomputation
  it('signs the fields named by MACParams with the real crypt', () => {
    const mapper = create(new PosNetV1PosCrypt(noopLogger))
    const actual = mapper.createCustomQueryRequestData(account, {
      MACParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate',
      CardInformationData: { CardNo: '4048090000000001', Cvc2: '123', ExpireDate: '2411' },
    })
    const signed = ['6700950031', '67540050', '4048090000000001', '123', '2411'].join('')
    const expected = createHash('sha256').update(`${signed}${KEY}`, 'utf8').digest('base64')
    expect(actual.MAC).toBe(expected)
  })

  // addition: the caller's object is not modified
  it('does not mutate the caller data', () => {
    const input = { TranType: 'Sale', MACParams: 'MerchantNo' }
    create(stub().crypt).createCustomQueryRequestData(account, input)
    expect(input).toEqual({ TranType: 'Sale', MACParams: 'MerchantNo' })
  })
})
