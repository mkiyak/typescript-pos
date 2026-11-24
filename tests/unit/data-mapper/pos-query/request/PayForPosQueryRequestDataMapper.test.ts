import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PayForPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PayForPosQueryRequestDataMapper.js'
import { PayForPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PayForPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { LANG } from '../../../../../src/PosInterface.js'

const account = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor',
  '085300000009704',
  'QNB_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
)
const zAccount = AccountFactory.createPayForPosAccount(
  'ziraat-katilim-payfor',
  '085300000009704',
  'ZIRAATKATILIM_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
  '12',
)

function create() {
  return new PayForPosQueryRequestDataMapper(
    new PayForPosRequestValueMapper(),
    new PayForPosRequestValueFormatter(),
    {} as unknown as CryptInterface<never>,
    LANG.EN,
  )
}

function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
}

describe('PayForPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PayForPosQueryRequestDataMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  describe('testCreateCustomQueryRequestData', () => {
    it('without_account_data', () => {
      const actual = create().createCustomQueryRequestData(account, { Type: 'Query', Number: '4111111111111111' })
      expect(sorted(actual)).toEqual(
        sorted({
          MerchantId: '085300000009704',
          UserCode: 'QNB_API_KULLANICI_3DPAY',
          UserPass: 'UcBN0',
          MbrId: '5',
          Type: 'Query',
          Number: '4111111111111111',
        }),
      )
    })

    it('with_account_data_already_set', () => {
      const input = {
        MerchantId: 'CUSTOM',
        UserCode: 'CUSTOMUSER',
        UserPass: 'CUSTOMPASS',
        MbrId: '99',
        Type: 'Query',
      }
      expect(sorted(create().createCustomQueryRequestData(account, input))).toEqual(sorted(input))
    })
  })

  describe('testCreateHistoryRequestData', () => {
    // deviation: F22 the request date is the Türkiye calendar day of an explicit instant
    it('finansbank_default_lang', () => {
      const actual = create().createHistoryRequestData(account, {
        transaction_date: new Date('2022-05-18T00:00:00+03:00'),
      })
      expect(sorted(actual)).toEqual(
        sorted({
          MerchantId: '085300000009704',
          UserCode: 'QNB_API_KULLANICI_3DPAY',
          UserPass: 'UcBN0',
          MbrId: '5',
          SecureType: 'Report',
          TxnType: 'TxnHistory',
          Lang: 'EN',
          ReqDate: '20220518',
        }),
      )
    })

    // deviation: F22 same as above
    it('with_explicit_lang_tr', () => {
      const actual = create().createHistoryRequestData(account, {
        transaction_date: new Date('2022-05-18T00:00:00+03:00'),
        lang: LANG.TR,
      })
      expect(sorted(actual)).toEqual(
        sorted({
          MerchantId: '085300000009704',
          UserCode: 'QNB_API_KULLANICI_3DPAY',
          UserPass: 'UcBN0',
          MbrId: '5',
          SecureType: 'Report',
          TxnType: 'TxnHistory',
          Lang: 'TR',
          ReqDate: '20220518',
        }),
      )
    })
  })

  // addition: a missing or invalid date is reported instead of sending "undefined"
  it.each([
    ['missing', {}],
    ['invalid date', { transaction_date: new Date('nope') }],
    ['a string', { transaction_date: '2022-05-18' }],
  ])('history with %s transaction_date throws PosError', (_name, data) => {
    expect(() => create().createHistoryRequestData(account, data)).toThrow(PosError)
  })

  // addition: the caller's data is never modified
  it('does not mutate the caller data', () => {
    const custom = { Type: 'Query' }
    create().createCustomQueryRequestData(account, custom)
    expect(custom).toEqual({ Type: 'Query' })
    const history = { transaction_date: new Date('2022-05-18T12:00:00+03:00') }
    create().createHistoryRequestData(account, history)
    expect(Object.keys(history)).toEqual(['transaction_date'])
  })

  // addition: the member id of the account is sent
  it('adds the member id of a Ziraat Katilim account', () => {
    expect(create().createCustomQueryRequestData(zAccount, {}).MbrId).toBe('12')
  })
})
