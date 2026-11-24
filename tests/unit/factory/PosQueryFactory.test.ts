import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, PosError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosConfig } from '../../../src/factory/PosFactory.js'
import { PosQueryFactory } from '../../../src/factory/PosQueryFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import type { PosLogger } from '../../../src/logger.js'
import { AbstractMappedPosQuery } from '../../../src/pos-query/AbstractMappedPosQuery.js'
import { AbstractPosQuery } from '../../../src/pos-query/AbstractPosQuery.js'
import { AkbankPosQuery } from '../../../src/pos-query/AkbankPosQuery.js'
import { AssecoPosQuery } from '../../../src/pos-query/AssecoPosQuery.js'
import { GarantiPosQuery } from '../../../src/pos-query/GarantiPosQuery.js'
import { InterPosQuery } from '../../../src/pos-query/InterPosQuery.js'
import { PayFlexCPV4PosQuery } from '../../../src/pos-query/PayFlexCPV4PosQuery.js'
import { PayFlexV4PosQuery } from '../../../src/pos-query/PayFlexV4PosQuery.js'
import { PayForPosQuery } from '../../../src/pos-query/PayForPosQuery.js'
import { PosNetPosQuery } from '../../../src/pos-query/PosNetPosQuery.js'
import { PosNetV1PosQuery } from '../../../src/pos-query/PosNetV1PosQuery.js'
import { VakifKatilimPosQuery } from '../../../src/pos-query/VakifKatilimPosQuery.js'
import { XmlEncoder } from '../../../src/serializer/XmlEncoder.js'
import type { PosHooks } from '../../../src/types.js'

const assecoConfig: PosConfig = {
  banks: {
    akbank: {
      name: 'Akbank',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
      },
    },
  },
}
const assecoAccount = (bank = 'akbank') => AccountFactory.createAssecoPosAccount(bank, '700655000200', 'u', 'p', 'k')
const cpAccount = () => AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', 'pw', 'VP1')

describe('PosQueryFactory', () => {
  it('testCreateReturnsCorrectPosQueryInstance', () => {
    const q = PosQueryFactory.createPosQuery(assecoAccount(), assecoConfig)
    expect(q).toBeInstanceOf(AssecoPosQuery)
    expect(q).toBeInstanceOf(AbstractPosQuery)
  })

  it('testCreateThrowsWhenGatewayClassMissingFromConfig', () => {
    const bank = { ...(assecoConfig.banks.akbank as GatewayConfig), class: undefined } as unknown as GatewayConfig
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), { banks: { akbank: bank } })).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('testCreateThrowsWhenNoPosQueryClassForGateway', () => {
    // deviation: Q7 no plain errors; PosFactory uses the same error for an unknown class
    const config: PosConfig = {
      banks: { akbank: { name: 'X', class: 'stdClass', gateway_endpoints: { payment_api: 'https://example.com' } } },
    }
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), config)).toThrow(GatewayClassNotConfiguredError)
  })

  // addition: behaviour the factory shares with PosFactory
  it('throws when the bank is not in the config', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('nobank'), assecoConfig)).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('creates PayFlexV4PosQuery and PayFlexCPV4PosQuery from the shipped test config', () => {
    const v4 = AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't')
    expect(PosQueryFactory.createPosQuery(v4, posTestConfig)).toBeInstanceOf(PayFlexV4PosQuery)
    expect(PosQueryFactory.createPosQuery(cpAccount(), posTestConfig)).toBeInstanceOf(PayFlexCPV4PosQuery)
  })

  it('getPosQueryClassForGateway returns the registered class or null', () => {
    expect(PosQueryFactory.getPosQueryClassForGateway('AkbankPos')).toBe(AkbankPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('AssecoPos')).toBe(AssecoPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('GarantiPos')).toBe(GarantiPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PayFlexV4Pos')).toBe(PayFlexV4PosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PayFlexCPV4Pos')).toBe(PayFlexCPV4PosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('stdClass')).toBeNull()
  })

  it('rejects an account of the wrong type', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('vakifbank'), posTestConfig)).toThrow(PosError)
    expect(() => PosQueryFactory.createPosQuery(cpAccount(), assecoConfigFor('AssecoPos'))).toThrow(PosError)
  })

  it('rejects an http: endpoint', () => {
    const config: PosConfig = {
      banks: {
        akbank: {
          ...(assecoConfig.banks.akbank as GatewayConfig),
          gateway_endpoints: { payment_api: 'http://entegrasyon.asseco-see.com.tr/fim/api' },
        },
      },
    }
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), config)).toThrow(PosError)
  })

  it('applies options.testMode', () => {
    expect(PosQueryFactory.createPosQuery(assecoAccount(), assecoConfig, { testMode: true }).isTestMode()).toBe(true)
  })

  it('passes fetch, hooks and allowedApiOrigins through to the query', async () => {
    const fake = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"ResultCode":"0000"}'),
    )
    const hook = vi.fn()
    const q = PosQueryFactory.createPosQuery(cpAccount(), posTestConfig, {
      fetch: fake as unknown as typeof fetch,
      hooks: { onPosQueryRequestDataPrepared: [hook] },
      allowedApiOrigins: ['https://apipos.vakifbank.com.tr:8443'],
    })

    await q.customQuery({ TransactionId: 'abc' }, 'https://apipos.vakifbank.com.tr:8443/x')
    expect(String(fake.mock.calls[0]?.[0])).toBe('https://apipos.vakifbank.com.tr:8443/x')
    expect(hook).toHaveBeenCalledTimes(1)

    await expect(q.customQuery({}, 'https://evil.example/')).rejects.toBeInstanceOf(PosError)
    expect(fake).toHaveBeenCalledTimes(1)
  })
})

const garantiAccount = () =>
  AccountFactory.createGarantiPosAccount('garanti', '7000679', 'PROVAUT', '123qweASD/', '30691298')

describe('PosQueryFactory with GarantiPos', () => {
  it('creates a GarantiPosQuery in test mode from the shipped test config', () => {
    const q = PosQueryFactory.createPosQuery(garantiAccount(), posTestConfig)
    expect(q).toBeInstanceOf(GarantiPosQuery)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
    expect(q.isTestMode()).toBe(true)
  })

  it('rejects an AssecoPosAccount for the garanti bank', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('garanti'), posTestConfig)).toThrow(PosError)
  })

  // addition: end to end through the real mappers, client and crypt with a fake fetch
  function e2e(answer: string, logger?: PosLogger) {
    const calls: Array<{ url: string; body: string }> = []
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body
      calls.push({
        url: String(url),
        body: typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('utf8'),
      })
      return new Response(answer, { status: 200 })
    }) as typeof fetch
    const q = PosQueryFactory.createPosQuery(garantiAccount(), posTestConfig, { fetch: fake, logger })
    return { q, calls }
  }

  const binAnswer =
    '<?xml version="1.0" encoding="UTF-8"?><GVPSResponse><Transaction><Response><Code>00</Code><ErrorMsg></ErrorMsg></Response></Transaction>' +
    '<BINInqResult><BINList><BIN><BINNum>415956</BINNum><BankCode>62</BankCode><BankName>T. GARANTİ BANKASI A.Ş.</BankName>' +
    '<Organization>VISA</Organization><CardType>C</CardType><Group>Garanti</Group><Product>GOLD</Product></BIN></BINList></BINInqResult></GVPSResponse>'

  it('getBinList posts a signed bininq request and maps one BIN', async () => {
    const { q, calls } = e2e(binAnswer)
    const result = await q.getBinList({ ip: '127.0.0.1', bin: '415956' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(posTestConfig.banks.garanti.gateway_endpoints.payment_api)
    const body = calls[0]?.body ?? ''
    expect(body).toContain('<GVPSRequest>')
    expect(body).toContain('<Type>bininq</Type>')
    expect(body).toContain('<BINNum>415956</BINNum>')
    expect(body).toContain('<Version>v0.1</Version>')
    expect(body).toContain('<Mode>TEST</Mode>')
    expect(body).toMatch(/<HashData>[0-9A-F]{128}<\/HashData>/)
    expect(result.status).toBe('approved')
    expect(result.bin_list).toEqual([
      {
        bin: '415956',
        bank_code: '62',
        bank_name: 'T. GARANTİ BANKASI A.Ş.',
        card_type: 'visa',
        card_class: 'credit',
        card_family: null,
      },
    ])
  })

  it('history posts the Türkiye wall-clock dates', async () => {
    const { q, calls } = e2e(
      '<GVPSResponse><Transaction><Response><Code>00</Code></Response></Transaction></GVPSResponse>',
    )
    const result = await q.history({
      ip: '127.0.0.1',
      start_date: new Date('2024-06-03T00:00:00+03:00'),
      end_date: new Date('2024-06-04T00:00:00+03:00'),
    })
    const body = calls[0]?.body ?? ''
    expect(body).toContain('<StartDate>03/06/2024 00:00</StartDate>')
    expect(body).toContain('<EndDate>04/06/2024 00:00</EndDate>')
    expect(body).toContain('<Type>orderlistinq</Type>')
    expect(result.status).toBe('approved')
  })

  it('customQuery adds the terminal and a signature', async () => {
    const { q, calls } = e2e(
      '<GVPSResponse><Transaction><Response><Code>00</Code></Response></Transaction></GVPSResponse>',
    )
    const result = await q.customQuery({ Order: { OrderID: 'O1' }, Transaction: { Type: 'orderinq', Amount: '100' } })
    const body = calls[0]?.body ?? ''
    expect(body).toContain('<ProvUserID>PROVAUT</ProvUserID>')
    expect(body).toMatch(/<HashData>[0-9A-F]{128}<\/HashData>/)
    expect(result).toHaveProperty('Transaction')
  })

  it('never logs the provisioning password', async () => {
    const lines: unknown[] = []
    const record = (...a: unknown[]) => void lines.push(a)
    const logger = { debug: record, info: record, warning: record, error: record } as unknown as PosLogger
    const { q } = e2e(binAnswer, logger)
    await q.getBinList({ ip: '127.0.0.1' })
    await q.customQuery({ Order: { OrderID: 'O1' }, Transaction: { Type: 'orderinq', Amount: '100' } })
    expect(lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(lines)).not.toContain('123qweASD/')
  })
})

function assecoConfigFor(cls: string): PosConfig {
  return {
    banks: {
      'vakifbank-cp': {
        name: 'X',
        class: cls,
        gateway_endpoints: { payment_api: 'https://example.com/api' },
      },
    },
  }
}

const SECRET =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'
const akbankAccount = () =>
  AccountFactory.createAkbankPosAccount(
    'akbank-pos',
    '2023090417500272654BD9A49CF07574',
    '2023090417500284633D137A249DBBEB',
    SECRET,
  )
const hmac = (s: string) => createHmac('sha512', SECRET).update(s, 'utf8').digest('base64')

describe('PosQueryFactory with AkbankPos', () => {
  it('creates an AkbankPosQuery in test mode from the shipped test config', () => {
    const q = PosQueryFactory.createPosQuery(akbankAccount(), posTestConfig)
    expect(q).toBeInstanceOf(AkbankPosQuery)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
  })

  it('rejects an AssecoPosAccount for the akbank-pos bank', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('akbank-pos'), posTestConfig)).toThrow(PosError)
  })

  // addition: end to end through the real mappers, signed client and crypt with a fake fetch
  function e2e(answer: string, logger?: PosLogger) {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = []
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body
      const text = typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('utf8')
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      // the signature must cover the exact body that was sent
      expect(headers['auth-hash']).toBe(hmac(text))
      calls.push({ url: String(url), body: text, headers })
      return new Response(answer, { status: 200 })
    })
    const q = PosQueryFactory.createPosQuery(akbankAccount(), posTestConfig, {
      fetch: fake as unknown as typeof fetch,
      logger,
    })
    return { q, calls, fake }
  }

  it('history posts the Türkiye wall-clock dates to the report endpoint and maps the answer', async () => {
    const answer = readFileSync(
      new URL('../test_data/akbankpos/history/daily_history_raw.json', import.meta.url),
      'utf8',
    )
    const { q, calls } = e2e(answer)
    const result = await q.history({
      start_date: new Date('2024-04-13T13:00:00+03:00'),
      end_date: new Date('2024-04-14T13:00:00+03:00'),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://apipre.akbank.com/api/v1/payment/virtualpos/portal/report/transaction')
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.report).toEqual({ startDateTime: '2024-04-13T13:00:00.000', endDateTime: '2024-04-14T13:00:00.000' })
    expect(body.terminal).toEqual({
      merchantSafeId: '2023090417500272654BD9A49CF07574',
      terminalSafeId: '2023090417500284633D137A249DBBEB',
    })
    expect(result.status).toBe('approved')
    expect(result.trans_count).toBe(525)
  })

  it('customQuery adds terminal, version and a 128-hex-digit random number and posts to the process endpoint', async () => {
    const { q, calls } = e2e('{"responseCode":"VPS-0000"}')
    const result = await q.customQuery({
      txnCode: '1020',
      order: { orderTrackId: 'ae15a6c8-467e-45de-b24c-b98821a42667' },
    })

    expect(calls[0]?.url).toBe('https://apipre.akbank.com/api/v1/payment/virtualpos/transaction/process')
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.version).toBe('1.00')
    expect(body.terminal.merchantSafeId).toBe('2023090417500272654BD9A49CF07574')
    expect(body.randomNumber).toMatch(/^[0-9A-F]{128}$/)
    expect(result).toEqual({ responseCode: 'VPS-0000' })
  })

  it('customQuery refuses a foreign origin without calling the bank', async () => {
    const { q, fake } = e2e('{}')
    await expect(q.customQuery({ txnCode: '1020' }, 'https://evil.example/x')).rejects.toBeInstanceOf(PosError)
    expect(fake).not.toHaveBeenCalled()
  })

  it('never logs the secret key or the signature', async () => {
    const lines: string[] = []
    const record = (...args: unknown[]) => void lines.push(JSON.stringify(args))
    const logger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const { q, calls } = e2e('{"responseCode":"VPS-0000"}', logger)
    await q.customQuery({ txnCode: '1020' })

    const all = lines.join('\n')
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(hmac(calls[0]?.body ?? ''))
  })
})

describe('PosQueryFactory with PosNetPos and PosNetV1Pos', () => {
  const Y_KEY = 'yapikredi-secret-key-7f3a91'
  const A_KEY = 'albaraka-secret-key-c42e08'
  const yAccount = () => AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426', Y_KEY)
  const aAccount = () =>
    AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010028724242434', A_KEY)
  const ALBARAKA_SALE = 'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc/Sale'

  it('creates the query classes from the shipped test config', () => {
    expect(PosQueryFactory.createPosQuery(yAccount(), posTestConfig)).toBeInstanceOf(PosNetPosQuery)
    expect(PosQueryFactory.createPosQuery(aAccount(), posTestConfig)).toBeInstanceOf(PosNetV1PosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PosNetPos')).toBe(PosNetPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PosNetV1Pos')).toBe(PosNetV1PosQuery)
  })

  it.each(['yapikredi', 'albaraka'])('rejects an AssecoPosAccount for the %s bank', (bank) => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(bank), posTestConfig)).toThrow(PosError)
  })

  // addition: end to end through the real mappers, clients and crypt with a fake fetch
  function e2e(account: ReturnType<typeof yAccount>, answer: string, logger?: PosLogger) {
    const calls: Array<{ url: string; body: string }> = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body
      calls.push({
        url: String(url),
        body: typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('latin1'),
      })
      return new Response(answer, { status: 200 })
    }) as unknown as typeof fetch
    const q = PosQueryFactory.createPosQuery(account, posTestConfig, { fetch: fetchFn, logger })
    return { q, calls, fetchFn }
  }

  const pointUsage = {
    pointUsage: {
      amount: '250',
      lpAmount: '40',
      ccno: '4048090000000001',
      currencyCode: 'TL',
      expDate: '2411',
      orderID: 'PKPPislemleriNT000000001',
    },
  }
  const xmlAnswer = '<?xml version="1.0" encoding="ISO-8859-9"?><posnetResponse><approved>1</approved></posnetResponse>'

  it('PosNetPos posts the xmldata form with mid and tid after the caller fields', async () => {
    const { q, calls } = e2e(yAccount(), xmlAnswer)
    const result = await q.customQuery(pointUsage)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://setmpos.ykb.com/PosnetWebService/XML')
    const body = calls[0]?.body ?? ''
    expect(body.startsWith('xmldata=')).toBe(true)
    expect(body).toContain('<posnetRequest>')
    expect(body).toMatch(/<\/pointUsage><mid>6706598320<\/mid><tid>67005551<\/tid>/)
    expect(result).toEqual({ approved: '1' })
  })

  it('PosNetPos rejects a value with an ampersand before sending anything', async () => {
    const { q, fetchFn } = e2e(yAccount(), xmlAnswer)
    await expect(q.customQuery({ note: 'a&b' })).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('PosNetV1Pos posts signed JSON to the given URL', async () => {
    const { q, calls } = e2e(aAccount(), '{"approved":"1"}')
    const result = await q.customQuery(
      {
        MACParams: 'MerchantNo:TerminalNo:CardNo',
        CardInformationData: { CardNo: '4048090000000001' },
      },
      ALBARAKA_SALE,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ALBARAKA_SALE)
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, string>
    expect(sent.ApiType).toBe('JSON')
    expect(sent.MerchantNo).toBe('6700950031')
    expect(sent.TerminalNo).toBe('67540050')
    const signed = '67009500316754005040480900000000'.concat('01')
    expect(sent.MAC).toBe(createHash('sha256').update(`${signed}${A_KEY}`, 'utf8').digest('base64'))
    expect(result).toEqual({ approved: '1' })
  })

  it('PosNetV1Pos without an apiUrl rejects with a PosError and sends nothing', async () => {
    const { q, fetchFn } = e2e(aAccount(), '{}')
    const err = await q.customQuery({ MACParams: 'MerchantNo' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toContain('apiUrl')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['yapikredi', 'https://evil.example/x'],
    ['albaraka', 'https://evil.example/x'],
  ])('%s: a URL on a foreign origin rejects before anything is sent', async (bank, url) => {
    const { q, fetchFn } = e2e(bank === 'yapikredi' ? yAccount() : aAccount(), '{}')
    await expect(q.customQuery({ MACParams: 'MerchantNo' }, url)).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('never logs the key, the card number or the expiry', async () => {
    const lines: unknown[] = []
    const record = (...a: unknown[]) => void lines.push(a)
    const logger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const y = e2e(yAccount(), xmlAnswer, logger)
    await y.q.customQuery(pointUsage)
    const a = e2e(aAccount(), '{"approved":"1"}', logger)
    await a.q.customQuery(
      { MACParams: 'MerchantNo:CardNo', CardInformationData: { CardNo: '4048090000000001', ExpireDate: '2411' } },
      ALBARAKA_SALE,
    )
    expect(lines.length).toBeGreaterThan(0)
    const text = JSON.stringify(lines)
    for (const secret of [Y_KEY, A_KEY, '4048090000000001', '2411', '"ExpireDate":"2411"', '<expDate>2411<']) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('PosQueryFactory with PayForPos', () => {
  const PASSWORD = 'UcBN0'
  const PAN = '4155650100416111'
  const qAccount = () =>
    AccountFactory.createPayForPosAccount(
      'qnbfinansbank-payfor',
      '085300000009704',
      'QNB_API_KULLANICI_3DPAY',
      PASSWORD,
      '12345678',
    )
  const zAccount = () =>
    AccountFactory.createPayForPosAccount(
      'ziraat-katilim-payfor',
      '085300000009704',
      'ZIRAATKATILIM_API_KULLANICI_3DPAY',
      PASSWORD,
      '12345678',
      '12',
    )
  const ENDPOINT = 'https://vpostest.qnb.com.tr/Gateway/XMLGate.aspx'

  it('creates the query class from the shipped test config', () => {
    expect(PosQueryFactory.createPosQuery(qAccount(), posTestConfig)).toBeInstanceOf(PayForPosQuery)
    expect(PosQueryFactory.createPosQuery(zAccount(), posTestConfig)).toBeInstanceOf(PayForPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PayForPos')).toBe(PayForPosQuery)
  })

  it('rejects an AssecoPosAccount for the PayFor bank', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('qnbfinansbank-payfor'), posTestConfig)).toThrow(PosError)
  })

  // addition: end to end through the real mappers, client and decoder with a fake fetch
  function e2e(answer: string, logger?: PosLogger) {
    const calls: Array<{ url: string; body: string }> = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) })
      return new Response(answer, { status: 200 })
    }) as unknown as typeof fetch
    const q = PosQueryFactory.createPosQuery(qAccount(), posTestConfig, { fetch: fetchFn, logger })
    return { q, calls, fetchFn }
  }

  const historyXml = () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../test_data/payfor/history/success_pay_response.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>
    // the attributes of the root element are dropped
    for (const key of Object.keys(fixture)) if (key.startsWith('@')) delete fixture[key]
    return XmlEncoder.encode(fixture, { rootName: 'PayforResponse', encoding: 'UTF-8' })
  }
  const inquiry = {
    SecureType: 'Inquiry',
    TxnType: 'ParaPuanInquiry',
    Pan: PAN,
    Expiry: '0125',
    Cvv2: '123',
  }

  it('custom query posts PayforRequest XML with the account fields after the caller fields', async () => {
    const { q, calls } = e2e('<PayforResponse><ProcReturnCode>00</ProcReturnCode></PayforResponse>')
    const result = await q.customQuery(inquiry)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
    const body = calls[0]?.body ?? ''
    expect(body).toContain('<PayforRequest>')
    expect(body).toContain(
      `<Cvv2>123</Cvv2><MerchantId>085300000009704</MerchantId><UserCode>QNB_API_KULLANICI_3DPAY</UserCode><UserPass>${PASSWORD}</UserPass><MbrId>5</MbrId>`,
    )
    expect(result).toEqual({ ProcReturnCode: '00' })
  })

  it('history posts the Türkiye day and maps the report', async () => {
    const { q, calls } = e2e(historyXml())
    const result = await q.history({ transaction_date: new Date('2024-01-21T12:00:00+03:00') })

    const body = calls[0]?.body ?? ''
    expect(calls[0]?.url).toBe(ENDPOINT)
    expect(body).toContain('<ReqDate>20240121</ReqDate>')
    expect(body).toContain('<SecureType>Report</SecureType>')
    expect(body).toContain('<TxnType>TxnHistory</TxnType>')
    expect(result.status).toBe('approved')
    expect(result.trans_count).toBe(1)
    const first = (result.transactions as Array<Record<string, unknown>>)[0]
    expect(first?.order_id).toBe('202401212A22')
    expect(first?.transaction_time).toEqual(new Date('2024-01-21T21:40:47+03:00'))
  })

  it('a URL on a foreign origin rejects before anything is sent', async () => {
    const { q, fetchFn } = e2e('<PayforResponse/>')
    await expect(q.customQuery(inquiry, 'https://evil.example/x')).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('masks the password, the card number, the expiry and the CVV in the logged request data', async () => {
    const lines: unknown[] = []
    const record = (...a: unknown[]) => void lines.push(a)
    const logger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const calls: string[] = []
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(init?.body))
      return new Response('<PayforResponse><ProcReturnCode>00</ProcReturnCode></PayforResponse>', { status: 200 })
    }) as unknown as typeof fetch
    // a hook that changes the data makes the query log the initial and the updated request data
    const hook = (e: { requestData: Record<string, unknown> }) => {
      e.requestData.Note = 'changed'
    }
    const q = PosQueryFactory.createPosQuery(qAccount(), posTestConfig, {
      fetch: fetchFn,
      logger,
      hooks: { onPosQueryRequestDataPrepared: [hook] },
    })
    await q.customQuery(inquiry)

    // the real values did go to the bank
    expect(calls[0]).toContain(`<UserPass>${PASSWORD}</UserPass>`)
    expect(calls[0]).toContain(`<Pan>${PAN}</Pan>`)

    const all = JSON.stringify(lines)
    expect(all).toContain('Request data is changed via listeners')
    expect(all).toContain('"UserPass":"***"')
    expect(all).toContain('"Cvv2":"***"')
    expect(all).toContain('"Expiry":"***"')
    expect(all).not.toContain(`"UserPass":"${PASSWORD}"`)
    expect(all).not.toContain(`"Pan":"${PAN}"`)
    expect(all).not.toContain(PAN)
    expect(all).not.toContain('"Expiry":"0125"')
    expect(all).not.toContain('"Cvv2":"123"')
  })
})

describe('PosQueryFactory with InterPos', () => {
  const USER_PASS = 'pw-Zk7Q'
  const PAN = '5555444433332222'
  const account = () => AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', USER_PASS, 'gDg1N')
  const ENDPOINT = 'https://test.inter-vpos.com.tr/mpi/Default.aspx'
  const inquiry = { TxnType: 'StatusHistory', orgOrderId: 'o1', SecureType: 'NonSecure', Pan: PAN }
  const ANSWER = 'ProcReturnCode=00;;Response=Approved;;ErrorMessage='

  function e2e(answer = ANSWER, logger?: PosLogger, hooks?: PosHooks) {
    const calls: Array<{ url: string; body: string; contentType: string | null }> = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: String(init?.body),
        contentType: new Headers(init?.headers).get('content-type'),
      })
      return new Response(answer, { status: 200 })
    }) as unknown as typeof fetch
    const q = PosQueryFactory.createPosQuery(account(), posTestConfig, { fetch: fetchFn, logger, hooks })
    return { q, calls, fetchFn }
  }

  it('creates the query class from the shipped test config', () => {
    expect(PosQueryFactory.createPosQuery(account(), posTestConfig)).toBeInstanceOf(InterPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('InterPos')).toBe(InterPosQuery)
  })

  it('rejects a PayForPosAccount for the denizbank bank', () => {
    const wrong = AccountFactory.createPayForPosAccount('denizbank', 'm', 'u', 'p', 'k')
    expect(() => PosQueryFactory.createPosQuery(wrong, posTestConfig)).toThrow(PosError)
  })

  it('history rejects as unsupported and sends nothing', async () => {
    const { q, fetchFn } = e2e()
    await expect(q.history({ transaction_date: new Date() })).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('custom query posts the form with the account fields after the caller fields and decodes the answer', async () => {
    const { q, calls } = e2e()
    const result = await q.customQuery(inquiry)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
    expect(calls[0]?.contentType).toContain('application/x-www-form-urlencoded')
    expect(calls[0]?.body).toBe(
      `TxnType=StatusHistory&orgOrderId=o1&SecureType=NonSecure&Pan=${PAN}&UserCode=InterTestApi&UserPass=${USER_PASS}&ShopCode=3123`,
    )
    expect(result).toEqual({ ProcReturnCode: '00', Response: 'Approved', ErrorMessage: '' })
  })

  it('a URL on a foreign origin rejects before anything is sent', async () => {
    const { q, fetchFn } = e2e()
    await expect(q.customQuery(inquiry, 'https://evil.example/x')).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('a plain http URL rejects before anything is sent', async () => {
    const { q, fetchFn } = e2e()
    await expect(q.customQuery(inquiry, 'http://test.inter-vpos.com.tr/mpi/Default.aspx')).rejects.toBeInstanceOf(
      PosError,
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('masks the user password and the card number in the logged request data', async () => {
    const lines: unknown[] = []
    const record = (...a: unknown[]) => void lines.push(a)
    const logger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    // a hook that changes the data makes the query log the initial and the updated request data
    const hook = (e: { requestData: Record<string, unknown> }) => {
      e.requestData.Note = 'changed'
    }
    const { q, calls } = e2e(ANSWER, logger, { onPosQueryRequestDataPrepared: [hook] })
    await q.customQuery(inquiry)

    // the real values did go to the bank
    expect(calls[0]?.body).toContain(`UserPass=${USER_PASS}`)
    expect(calls[0]?.body).toContain(`Pan=${PAN}`)

    const all = JSON.stringify(lines)
    expect(all).toContain('Request data is changed via listeners')
    expect(all).toContain('"UserPass":"***"')
    expect(all).toContain('"Pan":"***"')
    expect(all).not.toContain(`"UserPass":"${USER_PASS}"`)
    expect(all).not.toContain(USER_PASS)
    expect(all).not.toContain(PAN)
  })
})

describe('PosQueryFactory with VakifKatilimPos', () => {
  const PASSWORD = 'kdsnsksl'
  const account = () => AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', PASSWORD)
  const BASE = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home'
  const ONE_RECORD =
    '<VPosMessageContract><ResponseCode>00</ResponseCode><ResponseMessage></ResponseMessage><VPosOrderData><OrderContract><OrderId>1</OrderId><MerchantOrderId>A1</MerchantOrderId><ResponseCode>00</ResponseCode><FEC>0949</FEC><FirstAmount>10.01</FirstAmount></OrderContract></VPosOrderData></VPosMessageContract>'

  function e2e(answer: string, logger?: PosLogger, hooks?: PosHooks) {
    const calls: Array<{ url: string; body: string }> = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: Buffer.from(init?.body as Uint8Array).toString('latin1') })
      return new Response(answer, { status: 200 })
    }) as unknown as typeof fetch
    const q = PosQueryFactory.createPosQuery(account(), posTestConfig, { fetch: fetchFn, logger, hooks })
    return { q, calls, fetchFn }
  }

  it('creates the query class from the shipped test config', () => {
    expect(PosQueryFactory.createPosQuery(account(), posTestConfig)).toBeInstanceOf(VakifKatilimPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('VakifKatilimPos')).toBe(VakifKatilimPosQuery)
  })

  it('rejects an InterPosAccount for the vakif-katilim bank', () => {
    const wrong = AccountFactory.createInterPosAccount('vakif-katilim', 'm', 'u', 'p', 'k')
    expect(() => PosQueryFactory.createPosQuery(wrong, posTestConfig)).toThrow(PosError)
  })

  // K11: the Kuveyt gateway has no query class
  it('has no query for kuveytpos', () => {
    const kuveyt = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser', '400235', 'Key1')
    expect(() => PosQueryFactory.createPosQuery(kuveyt, posTestConfig)).toThrow(GatewayClassNotConfiguredError)
    expect(() => PosQueryFactory.createPosQuery(kuveyt, posTestConfig)).toThrow(
      'PosQuery not found for gateway KuveytPos',
    )
    expect(PosQueryFactory.getPosQueryClassForGateway('KuveytPos')).toBeNull()
  })

  it('history posts the signed window to SelectOrder and maps a two-record answer', async () => {
    const two =
      '<VPosMessageContract><ResponseCode>00</ResponseCode><VPosOrderData><OrderContract><OrderId>1</OrderId><MerchantOrderId>A1</MerchantOrderId><ResponseCode>00</ResponseCode><FirstAmount>10.01</FirstAmount></OrderContract><OrderContract><OrderId>2</OrderId><MerchantOrderId>A2</MerchantOrderId><ResponseCode>00</ResponseCode><FirstAmount>5.00</FirstAmount></OrderContract></VPosOrderData></VPosMessageContract>'
    const { q, calls } = e2e(two)
    const result = await q.history({
      start_date: new Date('2024-03-30T00:00:00+03:00'),
      end_date: new Date('2024-03-31T00:00:00+03:00'),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE}/SelectOrder`)
    const body = calls[0]?.body ?? ''
    expect(body).toContain('<StartDate>2024-03-30</StartDate><EndDate>2024-03-31</EndDate>')
    expect(body).toMatch(/<HashData>[A-Za-z0-9+/]{27}=<\/HashData>/)
    expect(result.status).toBe('approved')
    expect(result.trans_count).toBe(2)
    const orders = (result.transactions as Array<Record<string, unknown>>).map((t) => t.order_id)
    expect(orders).toEqual(['A2', 'A1'])
  })

  it('history maps a one-record answer', async () => {
    const { q } = e2e(ONE_RECORD)
    const result = await q.history({
      start_date: new Date('2024-03-30T00:00:00+03:00'),
      end_date: new Date('2024-03-31T00:00:00+03:00'),
    })
    expect(result.trans_count).toBe(1)
  })

  it('custom query posts the data unchanged to the given url and returns the decoded answer', async () => {
    const { q, calls } = e2e('<VPosMessageContract><ResponseCode>00</ResponseCode></VPosMessageContract>')
    const result = await q.customQuery({ MerchantOrderId: 'x' }, `${BASE}/SelectOrderByMerchantOrderId`)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE}/SelectOrderByMerchantOrderId`)
    expect(calls[0]?.body).toContain('<MerchantOrderId>x</MerchantOrderId>')
    expect(calls[0]?.body).not.toContain('UserName')
    expect(calls[0]?.body).not.toContain('HashData')
    expect(calls[0]?.body).not.toContain('MerchantId>')
    expect(result.ResponseCode).toBe('00')
  })

  it('a custom query without a url rejects and sends nothing', async () => {
    const { q, fetchFn } = e2e('<a/>')
    await expect(q.customQuery({ MerchantOrderId: 'x' })).rejects.toBeInstanceOf(PosError)
    await expect(q.customQuery({ MerchantOrderId: 'x' }, null)).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['a foreign origin', 'https://evil.example/x'],
    ['plain http', 'http://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home/SelectOrder'],
    ['embedded credentials', 'https://u:p@boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home/SelectOrder'],
    ['a look-alike host', 'https://boa.vakifkatilim.com.tr.evil.example/x'],
    ['text that is no url', 'not a url'],
  ])('a custom query url on %s rejects and sends nothing', async (_name, url) => {
    const { q, fetchFn } = e2e('<a/>')
    await expect(q.customQuery({ MerchantOrderId: 'x' }, url)).rejects.toBeInstanceOf(PosError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('the other queries reject as unsupported and send nothing', async () => {
    const { q, fetchFn } = e2e('<a/>')
    await expect(q.getBinList({})).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    await expect(q.getInstallmentRates({})).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    await expect(q.getInstallmentPrices({})).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  // the hook changes the data, so the query logs the initial and the updated request data
  it('masks the password hash and the signature in the logged request data', async () => {
    const lines: unknown[] = []
    const record = (...a: unknown[]) => void lines.push(a)
    const logger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const hook = (e: { requestData: Record<string, unknown> }) => {
      e.requestData.Note = 'changed'
    }
    const { q } = e2e(ONE_RECORD, logger, { onPosQueryRequestDataPrepared: [hook] })
    await q.history({
      start_date: new Date('2024-03-30T00:00:00+03:00'),
      end_date: new Date('2024-03-31T00:00:00+03:00'),
    })
    await q.customQuery(
      { MerchantOrderId: 'x', HashPassword: 'abc-hashed-pw', HashData: 'sig-value-1', CardNumber: '4155650100416111' },
      `${BASE}/SelectOrderByMerchantOrderId`,
    )

    const all = JSON.stringify(lines)
    expect(all).toContain('Request data is changed via listeners')
    expect(all).toContain('"HashData":"***"')
    expect(all).toContain('"HashPassword":"***"')
    expect(all).not.toContain('"HashPassword":"abc-hashed-pw"')
    expect(all).not.toContain('"HashData":"sig-value-1"')
    expect(all).not.toContain('abc-hashed-pw')
    expect(all).not.toContain('sig-value-1')
    expect(all).not.toContain('4155650100416111')
    expect(all).not.toContain(PASSWORD)
    expect(all).not.toMatch(/"HashData":"[A-Za-z0-9+/]{27}="/)
  })
})
