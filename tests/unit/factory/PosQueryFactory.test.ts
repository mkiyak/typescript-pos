import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, PosError } from '../../../src/errors.js'
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
import { PayFlexCPV4PosQuery } from '../../../src/pos-query/PayFlexCPV4PosQuery.js'
import { PayFlexV4PosQuery } from '../../../src/pos-query/PayFlexV4PosQuery.js'
import { PosNetPosQuery } from '../../../src/pos-query/PosNetPosQuery.js'
import { PosNetV1PosQuery } from '../../../src/pos-query/PosNetV1PosQuery.js'

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
