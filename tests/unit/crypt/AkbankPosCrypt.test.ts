import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

const SECRET =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'

const account = AccountFactory.createAkbankPosAccount(
  'akbank-pos',
  '2023090417500272654BD9A49CF07574',
  '2023090417500284633D137A249DBBEB',
  SECRET,
)

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const hmac = (text: string, key = SECRET): string => createHmac('sha512', key).update(text, 'utf8').digest('base64')

const secureFixture = (): GatewayResponseData => ({
  txnCode: '3001',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  txnDateTime: '2024-04-18T20:15:35.000',
  merchantSafeId: '2023090417500272654BD9A49CF07574',
  terminalSafeId: '2023090417500284633D137A249DBBEB',
  orderId: '20240418BA6C',
  secureEcomInd: '02',
  secureId: 'VG8yV2tCRHpTSlpNN2VqcDJRS1k=',
  secureData: 'kBM8+wZGAAAAAAAAAAAAAAAAAAAA',
  secureMd: '08A86B192287C69B2C443E7A42B29B5F46436C41DF8E159B4A232BB3D961940F',
  hashParams:
    'txnCode+responseCode+responseMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+secureId+secureEcomInd+secureData+secureMd',
  hash: 'bFYReNscRIyo3EQQm18qB9iZEW5eqtx1UBAjwRAoVJuigugPKr4Rjcf4PgBHtrjg1IYFYAz8k3TCFcKWS0b4Xg==',
})

const payHashParams =
  'txnCode+responseCode+responseMessage+hostResponseCode+hostMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+cardHolderName+authCode+rrn+batchNumber+stan+additionalInstallCount+deferingMonth+ccbEarnedRewardAmount+ccbBalanceRewardAmount+ccbRewardDesc+pcbEarnedRewardAmount+pcbBalanceRewardAmount+xcbEarnedRewardAmount+xcbBalanceRewardAmount'

const payFixture1 = (): GatewayResponseData => ({
  txnCode: '1000',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  hostResponseCode: '00',
  hostMessage: '000 ONAY KODU XXXXXX',
  txnDateTime: '2024-04-18T20:27:45.000',
  merchantSafeId: '2023090417500272654BD9A49CF07574',
  terminalSafeId: '2023090417500284633D137A249DBBEB',
  cardHolderName: 'TD**',
  orderId: '2024041811DA',
  authCode: '306456',
  rrn: '411024360235',
  batchNumber: '43',
  stan: '86',
  additionalInstallCount: '0',
  deferingMonth: '2',
  ccbEarnedRewardAmount: '0.01',
  ccbBalanceRewardAmount: '215.62',
  ccbRewardDesc: 'CHIP PARA',
  pcbEarnedRewardAmount: '0.00',
  pcbBalanceRewardAmount: '0.00',
  pcbRewardDesc: '',
  xcbEarnedRewardAmount: '0.00',
  xcbBalanceRewardAmount: '0.00',
  xcbRewardDesc: '',
  hashParams: payHashParams,
  hash: 'PO/pybfGrY7fesPoAq2U2B1bkpudx659yMyjTnnfP/Cw5MKR1t7mKvRnZdPBxu9nCC7qJFdr3mJSPTdMwYc3SA==',
})

const payFixture2 = (): GatewayResponseData => ({
  txnCode: '1000',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  hostResponseCode: '00',
  hostMessage: '000 ONAY KODU XXXXXX',
  txnDateTime: '2024-04-18T20:56:28.000',
  merchantSafeId: '2023090417500272654BD9A49CF07574',
  terminalSafeId: '2023090417500284633D137A249DBBEB',
  cardHolderName: 'TD**',
  orderId: '2024041898FD',
  authCode: '306460',
  rrn: '411024360239',
  batchNumber: '43',
  stan: '90',
  additionalInstallCount: '0',
  deferingMonth: '2',
  ccbEarnedRewardAmount: '0.01',
  ccbBalanceRewardAmount: '215.66',
  ccbRewardDesc: 'CHIP PARA',
  pcbEarnedRewardAmount: '0.00',
  pcbBalanceRewardAmount: '0.00',
  pcbRewardDesc: '',
  xcbEarnedRewardAmount: '0.00',
  xcbBalanceRewardAmount: '0.00',
  xcbRewardDesc: '',
  hashParams: payHashParams,
  hash: 'o8cVLBkljHc+1Icpoa35agcd7UPvD57gFY+bp7MQYznHnOr3f71vvsJwnbIQ2hGGVJj1nAdkZrh/lcVCdtMA+g==',
})

const declinedFixture = (): GatewayResponseData => ({
  txnCode: '',
  responseCode: 'VPS-1279',
  responseMessage: 'BKM 3DS Server Doğrulama Başarısız',
  hostResponseCode: '',
  hostMessage: '',
  merchantSafeId: '',
  terminalSafeId: '',
  orderId: '20240418D4A620240418D4A620240418D4A6',
  hashParams: 'responseCode+responseMessage+orderId',
  hash: 'fFFtzKUArgzhM/nUbw6pM/EA7AjecFyMV13G+1/GVn9C0S1XNeWdtT8+x4swaxi5TZfqzwPy5wtDajxSfkZmRA==',
})

const baseForm = {
  paymentModel: '3D',
  txnCode: '3000',
  merchantSafeId: '2023090417500272654BD9A49CF07574',
  terminalSafeId: '2023090417500284633D137A249DBBEB',
  orderId: '20240404A4B0',
  lang: 'TR',
  amount: '1.01',
  ccbRewardAmount: '1.00',
  pcbRewardAmount: '1.00',
  xcbRewardAmount: '1.00',
  currencyCode: '949',
  installCount: '1',
  okUrl: 'http://localhost/akbankpos/3d/response.php',
  failUrl: 'http://localhost/akbankpos/3d/response.php',
  subMerchantId: null,
  emailAddress: 'test@test.com',
  randomNumber:
    'AEDDD8688E11A3DC588DAB2ED59B2F64D45E798761CEFF17F4DB47581072697890180C4195986250F89C2C67A04A3B96F0AC66AE99B49BB7BEE618FBD621C4CD',
  requestDateTime: '2024-04-04T21:11:41.000',
  creditCard: '4355093000315232',
  expiredDate: '1135',
  cvv: '665',
}

const hashStringVectorBody =
  '{"terminal":{"merchantSafeId":"2023090417500272654BD9A49CF07574","terminalSafeId":"2023090417500284633D137A249DBBEB"},"version":"1.00","txnCode":"1010","requestDateTime":"2024-04-20T13:48:02.000","randomNumber":"59EED19EC4FA761B8D147F5175C915EFD69D193ED96114F9690505EDB02FF5FD3CB161A15FD5EFFB294177291DC27B2A9F58FB1DA6F2F4617762AF180A023A33","order":{"orderId":"2024042053E2"}}'

describe('AkbankPosCrypt', () => {
  let logger: MockLogger
  let crypt: AkbankPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new AkbankPosCrypt(logger as unknown as PosLogger)
  })

  it('supports only AkbankPos', () => {
    expect(AkbankPosCrypt.supports('AkbankPos')).toBe(true)
    expect(AkbankPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('generateRandomString defaults to 128 characters', () => {
    expect(crypt.generateRandomString()).toHaveLength(128)
    // addition: A11 (uppercase hex from the secure random source)
    expect(crypt.generateRandomString()).toMatch(/^[0-9A-F]{128}$/)
  })

  it('createHash is not implemented', () => {
    // deviation: A22 (error class: NotImplementedError)
    expect(() => crypt.createHash(account, {})).toThrow(NotImplementedError)
  })

  describe('hashString', () => {
    it('signs the reference request body', () => {
      expect(crypt.hashString(hashStringVectorBody, account.getSecretKey())).toBe(
        'D07V9wUXfyPbn+L8jqd9plMfJKT3gSy22Z+yruzWsvuJBkQ63fz+wcWjTF2XurVjYtnR7wLGYTJYg0xjDCYAHA==',
      )
    })

    it('requires a key', () => {
      // deviation: A22 (error class: MissingAccountInfoError)
      expect(() => crypt.hashString('abc')).toThrow(MissingAccountInfoError)
    })

    // addition: A1 (a blank key is as missing as none)
    it.each(['', '  '])('rejects the blank key %j', (key) => {
      expect(() => crypt.hashString('x', key)).toThrow(MissingAccountInfoError)
    })

    // addition: A1 (non-ASCII bodies are signed as UTF-8)
    it('signs a non-ASCII body as UTF-8', () => {
      const body = '{"customer":{"ipAddress":"127.0.0.1"},"order":{"orderId":"sipariş-ğü-1"},"note":"Çağrı Öztürk"}'
      expect(crypt.hashString(body, account.getSecretKey())).toBe(
        'n+vx1zewaPLRa2AOLdP3XO295yqNm4uEDN7wLrXqjqmkSD4F/7T8BPfm2id8LV29HfJnvysnnfujchFHfKm3UA==',
      )
    })
  })

  describe('create3DHash', () => {
    it.each([
      [
        '3d_secure',
        baseForm,
        'ilR2mCExklKEti+2x61A8pcOfzJ5z5M6xMYmmU8ClaKaDuxKooFuH3v7XW/ba25xlTDqGN1H//i0zTiJl5YnfA==',
      ],
      [
        '3d_secure_with_sub_merchant_id',
        { ...baseForm, subMerchantId: 'hdfksafjsallk' },
        'blqnTrcdZ2JhQBjOmIhyYPhKvC4BlbG7oArE5IkCeuo8CwaYV69EJSOph7J1JKY9opIsmc5QoscGmltGMUJtTQ==',
      ],
      [
        '3d_host',
        {
          paymentModel: 'MODEL_3D_HOST',
          txnCode: '3000',
          merchantSafeId: '2023090417500272654BD9A49CF07574',
          terminalSafeId: '2023090417500284633D137A249DBBEB',
          orderId: '20240404A4B0',
          lang: 'TR',
          amount: '1.01',
          ccbRewardAmount: '1.00',
          pcbRewardAmount: '1.00',
          xcbRewardAmount: '1.00',
          currencyCode: '949',
          installCount: '1',
          okUrl: 'http://localhost/akbankpos/3d/response.php',
          failUrl: 'http://localhost/akbankpos/3d/response.php',
          subMerchantId: null,
          emailAddress: 'test@test.com',
          randomNumber:
            'AEDDD8688E11A3DC588DAB2ED59B2F64D45E798761CEFF17F4DB47581072697890180C4195986250F89C2C67A04A3B96F0AC66AE99B49BB7BEE618FBD621C4CD',
          requestDateTime: '2024-04-04T21:11:41.000',
        },
        '36uUlZFNi+Fs928RPt9CUfKfq+2hTWKK6idWFXjwnO47Qz4pVk6bliSUY+4RGw8Fzcqz+MUWQQ2Grz2zk4l9og==',
      ],
    ])('%s', (_name, formInputs, expected) => {
      expect(crypt.create3DHash(account, formInputs as never)).toBe(expected)
    })

    // addition: A2 (non-ASCII values, amount 0.29, absent optional fields)
    it('signs a non-ASCII form with absent optional fields', () => {
      const { ccbRewardAmount, pcbRewardAmount, xcbRewardAmount, emailAddress, ...rest } = baseForm
      const form = {
        ...rest,
        paymentModel: '3D_PAY',
        orderId: 'sipariş-1',
        amount: '0.29',
        okUrl: 'https://örnek.com.tr/ok',
        failUrl: 'https://örnek.com.tr/fail',
        randomNumber: 'A1'.repeat(64),
      }
      expect(crypt.create3DHash(account, form as never)).toBe(
        '6izSc30LlPEbTxCtBvvgDuHKhyTrl+iMYX8vjZhx6Vx3ePF+a+uVNi4w3c7JPb2R/q1CCeJMrvIaOuavPlfPYA==',
      )
    })

    // addition: A2 (a required field is never signed as "undefined")
    it.each([
      ['randomNumber', undefined],
      ['okUrl', ''],
    ])('rejects a missing or empty required field %s', (name, value) => {
      const spy = vi.spyOn(crypt, 'hashString')
      const form: Record<string, unknown> = { ...baseForm, [name]: value }
      if (value === undefined) delete form[name]
      expect(() => crypt.create3DHash(account, form as never)).toThrow(PosError)
      for (const call of spy.mock.calls) {
        expect(call[0]).not.toContain('undefined')
      }
    })
  })

  describe('check3DHash', () => {
    it.each([
      ['3d secure', secureFixture],
      ['3d pay 1', payFixture1],
      ['3d pay 2', payFixture2],
    ])('%s', (_name, fixture) => {
      expect(crypt.check3DHash(account, fixture())).toBe(true)

      const data = fixture()
      data.responseCode = ''
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    // addition: A3
    describe('hardening', () => {
      it('accepts a declined callback signed by the bank', () => {
        expect(crypt.check3DHash(account, declinedFixture())).toBe(true)
      })

      it('is case sensitive', () => {
        const data = secureFixture()
        data.hash = String(data.hash).toLowerCase()
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it('rejects a field list where the decisive code is not at a fixed offset', () => {
        // the hash is the PHP-verified HMAC of the reordered fields, so only the offset rule can reject it
        const data = secureFixture()
        data.hashParams =
          'responseMessage+txnCode+responseCode+txnDateTime+merchantSafeId+terminalSafeId+orderId+secureId+secureEcomInd+secureData+secureMd'
        data.hash = '1TQ3IjIrlerWTTrkkarFO2Wl2DzrfDkZBnH2vZcqP1xGoDAhoDJbcHRNkFliKjQa+aeXbXvgPHFeqt/OE1nS3w=='
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it.each([
        ['a duplicate name', 'responseCode+orderId+orderId'],
        ['an empty name', 'responseCode++orderId'],
      ])('rejects %s in the field list', (_name, hashParams) => {
        const data = declinedFixture()
        data.hashParams = hashParams
        const names = hashParams.split('+')
        data.hash = hmac(names.map((n) => (n === '' ? '' : String(data[n]))).join(''))
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      // each case below is signed over the text a naive implementation would build, so only the own non-empty
      // string check on the named fields can reject it
      it('rejects a named field that is missing', () => {
        const data = declinedFixture()
        data.hashParams = 'responseCode+responseMessage+orderId+authCode'
        data.hash = hmac(`${data.responseCode}${data.responseMessage}${data.orderId}`)
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it('rejects a named field that is empty', () => {
        const data = declinedFixture()
        data.hashParams = 'txnCode+responseCode+responseMessage+orderId'
        data.hash = hmac(`${data.responseCode}${data.responseMessage}${data.orderId}`)
        expect(data.txnCode).toBe('')
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it.each([
        ['an object', { a: '1' }, '[object Object]'],
        ['an array', ['1'], '1'],
      ])('rejects %s as a named field value', (_name, value, naive) => {
        const data = declinedFixture()
        data.orderId = value as never
        data.hash = hmac(`${data.responseCode}${data.responseMessage}${naive}`)
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it('has no recursive hash helper', () => {
        expect(() => crypt.hashFromParams(account, declinedFixture(), 'responseCode', '+')).toThrow(NotImplementedError)
      })

      it.each([
        ['missing hash', (d: GatewayResponseData) => delete d.hash],
        ['empty hash', (d: GatewayResponseData) => Object.assign(d, { hash: '' })],
        ['numeric hash', (d: GatewayResponseData) => Object.assign(d, { hash: 123 as never })],
        ['missing hashParams', (d: GatewayResponseData) => delete d.hashParams],
      ])('returns false on %s without throwing', (_name, mutate) => {
        const data = secureFixture()
        mutate(data)
        expect(crypt.check3DHash(account, data)).toBe(false)
      })

      it('logs the order and the field list but neither the generated hash nor the secret', () => {
        const data = secureFixture()
        data.orderId = '20240418BA6X'
        expect(crypt.check3DHash(account, data)).toBe(false)

        const [, context] = logger.error.mock.calls[0] as [string, Record<string, unknown>]
        expect(context.order_id).toBe('20240418BA6X')
        expect(context.hash_params).toBe(data.hashParams)

        const generated = hmac(
          String(data.hashParams)
            .split('+')
            .map((n) => String(data[n]))
            .join(''),
        )
        const text = JSON.stringify(logger.error.mock.calls)
        expect(text).not.toContain(generated)
        expect(text).not.toContain(SECRET)
      })
    })
  })
})
