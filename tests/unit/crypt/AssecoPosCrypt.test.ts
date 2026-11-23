import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssecoPosCrypt } from '../../../src/crypt/AssecoPosCrypt.js'
import { NotImplementedError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL } from '../../../src/PosInterface.js'
import type { GatewayResponseData } from '../../../src/types.js'

const account = AccountFactory.createAssecoPosAccount('akbank', '190100000', 'ISBANKAPI', 'ISBANK07', '123456')

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const callbackData = (): GatewayResponseData =>
  ({
    ReturnOid: '202210308C0F',
    TRANID: null,
    hashAlgorithm: 'ver3',
    PAResSyntaxOK: 'true',
    firmaadi: 'John Doe',
    islemtipi: 'Auth',
    lang: 'tr',
    merchantID: '190200000',
    maskedCreditCard: '4355 08** **** 4358',
    amount: '1.01',
    sID: '1',
    ACQBIN: '454672',
    Ecom_Payment_Card_ExpDate_Year: '26',
    EXTRA_CARDBRAND: 'VISA',
    Email: 'mail@customer.com',
    MaskedPan: '435508***4358',
    acqStan: '184784',
    merchantName: 'Ziraat 3D_Pay',
    clientIp: '89.244.149.137',
    EXTRA_KAZANILANPUAN: '000000010.00',
    okUrl: 'http://localhost/akbank/3d-pay/response.php',
    md: '435508:51104213993AC8DFE8839C7F7E391B461115D09A1D88948C8ACE421D7D7EAA5A:3545:##190200000',
    ProcReturnCode: '00',
    payResults_dsId: '1',
    taksit: null,
    TransId: '22303RqiC11252',
    EXTRA_TRXDATE: '20221030 17:42:33',
    Ecom_Payment_Card_ExpDate_Month: '12',
    storetype: '3d_pay',
    Response: 'Approved',
    SettleId: '2383',
    mdErrorMsg:
      'Y-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/creq?token=214711321.1667140951.Ud_jQl3B2l1',
    ErrMsg: null,
    PAResVerified: 'true',
    cavv: 'ABABBCgghAAAAABllJMDdZdTdic=',
    digest: 'digest',
    HostRefNum: '230317184784',
    callbackCall: 'true',
    AuthCode: '216981',
    failUrl: 'http://localhost/akbank/3d-pay/response.php',
    xid: 'N1An1iS5iN4u/1VWS6CgzSGRtN0=',
    encoding: 'ISO-8859-9',
    currency: '949',
    oid: '202210308C0F',
    mdStatus: '1',
    dsId: '1',
    eci: '05',
    version: '2.0',
    EXTRA_CARDISSUER: 'AKBANK T.A.S.',
    clientid: '190200000',
    txstatus: 'Y',
    HASH: 'jVgcwtx4vxxAcX8+ajsrrzp77k9uaGu1pjDQfCpoUG95y2MwwGipc6cF3kESiTphjV8/1ESSc6zg9KyTSxUnzA==',
    rnd: 'J/jGATA5LLVaMfpU+Yyu',
  }) as unknown as GatewayResponseData

describe('AssecoPosCrypt', () => {
  let logger: MockLogger
  let crypt: AssecoPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new AssecoPosCrypt(logger as unknown as PosLogger)
  })

  it('supports only AssecoPos', () => {
    expect(AssecoPosCrypt.supports('AssecoPos')).toBe(true)
    expect(AssecoPosCrypt.supports('AkbankPos')).toBe(false)
  })

  it('check3DHash accepts the bank callback and rejects a tampered one', () => {
    const data = callbackData()
    expect(crypt.check3DHash(account, data)).toBe(true)

    data.mdStatus = ''
    expect(crypt.check3DHash(account, data)).toBe(false)
  })

  it.each([
    [
      '3d_pay',
      {
        clientid: account.getMerchantId(),
        storetype: '3d_pay',
        amount: '100.25',
        oid: 'order222',
        okUrl: 'https://domain.com/success',
        failUrl: 'https://domain.com/fail_url',
        rnd: 'rand',
        lang: 'tr',
        currency: '949',
        taksit: '',
        islemtipi: 'Auth',
        firmaadi: 'siparis veren',
        Email: 'test@test.com',
        hashAlgorithm: 'ver3',
      },
      '/uPxhEKWCEGi3NsDOOQ4u8Hu5g71v5GWspOid70WehTWEz97PqxG3IN1Jv5jsbOXOw3Z3Rr/0UtywzEgbqFfdA==',
    ],
    [
      '3d_secure',
      {
        clientid: account.getMerchantId(),
        storetype: MODEL.THREE_D_SECURE,
        amount: '100.25',
        oid: 'order222',
        okUrl: 'https://domain.com/success',
        failUrl: 'https://domain.com/fail_url',
        rnd: 12345,
        hashAlgorithm: 'ver3',
        lang: 'tr',
        currency: 949,
        islemtipi: 'Auth',
        taksit: '',
      },
      '4aUsG5hqlIFLc9s8PKc5rWb2OLhmxDDewNgKa2XrwoYCIxlyVq8Fjl4IVaZzoqL983CfTseicmnTA0PjZr74xg==',
    ],
  ])('create3DHash %s', (_name, inputs, expected) => {
    expect(crypt.create3DHash(account, inputs as unknown as Record<string, string>)).toBe(expected)
  })

  it('create3DHash for 3D secure (explicit case)', () => {
    const inputs = {
      clientid: account.getMerchantId(),
      storetype: MODEL.THREE_D_SECURE,
      amount: '100.25',
      oid: 'order222',
      okUrl: 'https://domain.com/success',
      failUrl: 'https://domain.com/fail_url',
      rnd: 12345,
      hashAlgorithm: 'ver3',
      lang: 'tr',
      currency: 949,
      islemtipi: 'Auth',
      taksit: '',
    }
    expect(crypt.create3DHash(account, inputs as unknown as Record<string, string>)).toBe(
      '4aUsG5hqlIFLc9s8PKc5rWb2OLhmxDDewNgKa2XrwoYCIxlyVq8Fjl4IVaZzoqL983CfTseicmnTA0PjZr74xg==',
    )
  })

  it('createHash is not implemented', () => {
    expect(() => crypt.createHash(account, {})).toThrow(NotImplementedError)
  })

  // Extra cases (values computed with PHP builtins: ksort(SORT_NATURAL|SORT_FLAG_CASE), str_replace, hash('sha512'))
  describe('extra cases', () => {
    const secretAccount = AccountFactory.createAssecoPosAccount('b', '190100000', 'u', 'p', 's3cret')
    const turkish = {
      clientid: '190100000',
      BillToName: 'İşbank Ödeme ĞÜŞ',
      nationalidno: '12345678901',
      oid: 'o1',
      amount: '100.25',
      storetype: '3d',
      hashAlgorithm: 'ver3',
    }
    // PHP string: 100.25|İşbank Ödeme ĞÜŞ|190100000|ver3|o1|3d|s3cret
    const turkishHash = 'JNLcuBI8EI0fhCRMdbmlChrc95ALUa95x++8Q6gkLuqZqhZjAJKgM3DVCBDI434XWQTewDLam+1bZEJgGVVEGA=='

    it('hashes non-ASCII data as UTF-8 and ignores nationalidno, hash and encoding', () => {
      expect(crypt.create3DHash(secretAccount, turkish)).toBe(turkishHash)
      expect(
        crypt.create3DHash(secretAccount, { ...turkish, encoding: 'ISO-8859-9', HASH: 'whatever', Hash: 'x' }),
      ).toBe(turkishHash)
    })

    it('check3DHash verifies the same non-ASCII data once HASH is set to the computed value', () => {
      const data: GatewayResponseData = { ...turkish, HASH: turkishHash, encoding: 'UTF-8' }
      expect(crypt.check3DHash(secretAccount, data)).toBe(true)
      expect(crypt.check3DHash(secretAccount, { ...data, BillToName: 'Isbank Odeme' })).toBe(false)
    })

    it('escapes backslash and pipe in values', () => {
      // PHP string: x\|y\\z|q|s3cret
      expect(crypt.create3DHash(secretAccount, { a: 'x|y\\z', b: 'q' })).toBe(
        'iL/0Lmjql+7k009oGVdbLio7bqsZBiCcktUO+UtfJbh2qsAhMXkq/UXgRlXvo0Zd1KURCMnmwbyI5+c2j22tnA==',
      )
    })

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['non-string', 12345],
      ['null', null],
    ])('check3DHash returns false (no throw) when HASH is %s', (_n, hash) => {
      const data = { ...turkish, HASH: hash } as unknown as GatewayResponseData
      expect(crypt.check3DHash(secretAccount, data)).toBe(false)
    })

    it('never logs the store key or the generated hash on mismatch', () => {
      const data: GatewayResponseData = { ...turkish, HASH: 'forged' }
      expect(crypt.check3DHash(secretAccount, data)).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
      const logged = JSON.stringify(logger.error.mock.calls)
      expect(logged).not.toContain('s3cret')
      expect(logged).not.toContain(turkishHash)
      expect(logged).toContain('hash check failed')
    })
  })
})
