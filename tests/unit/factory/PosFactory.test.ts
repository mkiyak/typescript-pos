import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, MissingAccountInfoError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { type PosConfig, PosFactory } from '../../../src/factory/PosFactory.js'
import type { AbstractGateway, GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { AkbankPos } from '../../../src/gateway/AkbankPos.js'
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { GarantiPos } from '../../../src/gateway/GarantiPos.js'
import { InterPos } from '../../../src/gateway/InterPos.js'
import { KuveytPos } from '../../../src/gateway/KuveytPos.js'
import { Param3DHostPos } from '../../../src/gateway/Param3DHostPos.js'
import { ParamPos } from '../../../src/gateway/ParamPos.js'
import { PayFlexCPV4Pos } from '../../../src/gateway/PayFlexCPV4Pos.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'
import { PayForPos } from '../../../src/gateway/PayForPos.js'
import { PayTrPos } from '../../../src/gateway/PayTrPos.js'
import { PosNetPos } from '../../../src/gateway/PosNetPos.js'
import { PosNetV1Pos } from '../../../src/gateway/PosNetV1Pos.js'
import { ToslaPos } from '../../../src/gateway/ToslaPos.js'
import { VakifKatilimPos } from '../../../src/gateway/VakifKatilimPos.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../src/PosInterface.js'
import type { PosHooks, PosOrder } from '../../../src/types.js'

const assecoAccount = (bank = 'asseco') => AccountFactory.createAssecoPosAccount(bank, '700655000200', 'u', 'p', 'k')
const payFlexAccount = (bank = 'vakifbank') =>
  AccountFactory.createPayFlexPosAccount(bank, '000000000011445', 'p', 'VP1')

const garantiAccount = (bank = 'garanti') =>
  AccountFactory.createGarantiPosAccount(bank, '7000679', 'PROVAUT', '123qweASD/', '30691297', '12345678')

const posNetAccount = (bank = 'yapikredi') => AccountFactory.createPosNetPosAccount(bank, 'm', 't', 'p', 'k')

const akbankAccount = (bank = 'akbank-pos') => AccountFactory.createAkbankPosAccount(bank, 'm', 't', 'k')

const config: PosConfig = {
  banks: {
    asseco: {
      name: 'Asseco/Payten',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
      },
    },
    vakifbank: {
      name: 'VakifBank-VPOS',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://pay.example.com/Vposreq',
        gateway_3d: 'https://pay.example.com/Enrollment',
        query_api: 'https://pay.example.com/Search',
      },
    },
  },
}

const assecoCfg = config.banks.asseco as GatewayConfig
const vakifCfg = config.banks.vakifbank as GatewayConfig

describe('PosFactory.createPosGateway', () => {
  it('creates an AssecoPos gateway', () => {
    const account = assecoAccount()
    const gateway = PosFactory.createPosGateway(account, config)
    expect(gateway).toBeInstanceOf(AssecoPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCurrencies().length).toBeGreaterThan(0)
    expect(gateway.getCardTypeMapping()).toStrictEqual({}) // AssecoPos has no card type mapping
    expect(gateway.isTestMode()).toBe(false)
  })

  it('creates a PayFlexV4Pos gateway', () => {
    const account = payFlexAccount()
    const gateway = PosFactory.createPosGateway(account, config)
    expect(gateway).toBeInstanceOf(PayFlexV4Pos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCurrencies().length).toBeGreaterThan(0)
    expect(Object.keys(gateway.getCardTypeMapping()).length).toBeGreaterThan(0)
    expect(gateway.get3DGatewayURL()).toBe('https://pay.example.com/Enrollment')
  })

  it('creates a PayFlexCPV4Pos gateway from the shipped test config', () => {
    const account = payFlexAccount('vakifbank-cp')
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(PayFlexCPV4Pos)
    expect(gateway.getAccount()).toBe(account)
  })

  it('creates a GarantiPos gateway from the shipped test config', () => {
    const account = garantiAccount()
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(GarantiPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({}) // GarantiPos has no card type mapping
    expect(gateway.isTestMode()).toBe(true)
  })

  it.each([
    ['yapikredi', PosNetPos],
    ['albaraka', PosNetV1Pos],
  ] as const)('creates the %s PosNet gateway from the shipped test config', (bank, gatewayClass) => {
    const account = posNetAccount(bank)
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(gatewayClass)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies()).toHaveLength(6)
  })

  // addition: the account type must fit the gateway
  it.each([
    ['yapikredi', 'PosNetPos'],
    ['albaraka', 'PosNetV1Pos'],
  ])('rejects a non-PosNet account for %s', (bank, name) => {
    expect(() => PosFactory.createPosGateway(assecoAccount(bank), posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount(bank), posTestConfig)).toThrow(
      new RegExp(`configured for ${name} and needs a PosNetPosAccount`),
    )
  })

  // addition: the PosNet client posts the reverse request to the configured endpoint
  it('sends a PosNetPos cancel to the test endpoint with a 24 character order id', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: Buffer.from(init?.body as Uint8Array).toString('latin1') })
      return new Response('<posnetResponse><approved>0</approved></posnetResponse>', { status: 200 })
    }) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(posNetAccount(), posTestConfig, { fetch: fetchImpl })
    await gateway.cancel({ id: '1', payment_model: 'regular' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://setmpos.ykb.com/PosnetWebService/XML')
    expect(calls[0]?.body).toContain('xmldata=')
    expect(calls[0]?.body).toContain(
      '<reverse><transaction>sale</transaction><orderID>000000000000000000000001</orderID></reverse>',
    )
  })

  // addition: the PosNetV1 client names the URL after the transaction
  it('sends a PosNetV1Pos status to the TransactionInquiry URL', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url))
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(posNetAccount('albaraka'), posTestConfig, { fetch: fetchImpl })
    await gateway.status({ id: '1' } as never).catch(() => undefined)
    expect(urls).toEqual([
      'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc/TransactionInquiry',
    ])
  })

  it.each([['qnbfinansbank-payfor'], ['ziraat-katilim-payfor']])(
    'creates the %s PayForPos gateway from the shipped test config',
    (bank) => {
      const account = AccountFactory.createPayForPosAccount(bank, 'm', 'u', 'p', 'k')
      const gateway = PosFactory.createPosGateway(account, posTestConfig)
      expect(gateway).toBeInstanceOf(PayForPos)
      expect(gateway.getAccount()).toBe(account)
      expect(gateway.getCardTypeMapping()).toStrictEqual({})
      expect(gateway.getCurrencies()).toHaveLength(6)
    },
  )

  // addition: the account type must fit the gateway
  it('rejects a non-PayFor account for a PayForPos bank', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('qnbfinansbank-payfor'), posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('qnbfinansbank-payfor'), posTestConfig)).toThrow(
      'Bank [qnbfinansbank-payfor] is configured for PayForPos and needs a PayForPosAccount.',
    )
  })

  // addition: the PayFor client posts the order inquiry to the configured endpoint
  it('sends a PayForPos status to the QNB test endpoint', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) })
      return new Response('<PayforResponse/>', { status: 200 })
    }) as unknown as typeof fetch
    const account = AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', 'k')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    await gateway.status({ id: '2020110828BC' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://vpostest.qnb.com.tr/Gateway/XMLGate.aspx')
    expect(calls[0]?.body).toContain('PayforRequest')
    expect(calls[0]?.body).toContain('<OrgOrderId>2020110828BC</OrgOrderId>')
    expect(calls[0]?.body).toContain('<TxnType>OrderInquiry</TxnType>')
  })

  // addition: the Ziraat Katilim entry uses its own host, language and member id
  it('sends a PayForPos status of Ziraat Katilim to its test endpoint', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) })
      return new Response('<PayforResponse/>', { status: 200 })
    }) as unknown as typeof fetch
    const account = AccountFactory.createPayForPosAccount('ziraat-katilim-payfor', 'm', 'u', 'p', 'k', '12')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    await gateway.status({ id: '2020110828BC' } as never)
    expect(calls[0]?.url).toBe('https://payfortestziraatkatilim.cordisnetwork.com/Mpi/XMLGate.aspx')
    expect(calls[0]?.body).toContain('<Lang>TR</Lang>')
    expect(calls[0]?.body).toContain('<MbrId>12</MbrId>')
  })

  it('creates the denizbank InterPos gateway from the shipped test config', () => {
    const account = AccountFactory.createInterPosAccount('denizbank', 's', 'u', 'p', 'k')
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(InterPos)
    expect(gateway.getAccount()).toBe(account)
    expect(Object.keys(gateway.getCardTypeMapping())).toHaveLength(4)
    expect(gateway.getCurrencies()).toHaveLength(6)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-InterPos account for an InterPos bank', () => {
    const wrong = AccountFactory.createPayForPosAccount('denizbank', 'm', 'u', 'p', 'k')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [denizbank] is configured for InterPos and needs an InterPosAccount.',
    )
  })

  // addition: the InterPos client posts the order inquiry form to the configured endpoint
  it('sends an InterPos status to the Denizbank test endpoint', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) })
      return new Response('OrderId=2020110828BC;;ProcReturnCode=81;;ErrorMessage=x', { status: 200 })
    }) as unknown as typeof fetch
    const account = AccountFactory.createInterPosAccount('denizbank', 's', 'u', 'p', 'k')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const result = await gateway.status({ id: '2020110828BC' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://test.inter-vpos.com.tr/mpi/Default.aspx')
    expect(calls[0]?.body).toBe(
      'UserCode=u&UserPass=p&ShopCode=s&orgOrderId=2020110828BC&TxnType=StatusHistory&SecureType=NonSecure&Lang=tr',
    )
    expect(result.status).toBe('declined')
  })

  it('creates the kuveytpos KuveytPos gateway from the shipped test config', () => {
    const account = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', 'Api123')
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(KuveytPos)
    expect(gateway.getAccount()).toBe(account)
    expect(Object.keys(gateway.getCardTypeMapping())).toHaveLength(3)
    expect(gateway.getCurrencies()).toHaveLength(3)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-BOA account for a KuveytPos bank', () => {
    const wrong = AccountFactory.createInterPosAccount('kuveytpos', 's', 'u', 'p', 'k')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [kuveytpos] is configured for KuveytPos and needs a BoaPosAccount.',
    )
  })

  it('creates the vakif-katilim VakifKatilimPos gateway from the shipped test config', () => {
    const account = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(VakifKatilimPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies()).toHaveLength(6)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-BOA account for a VakifKatilimPos bank', () => {
    const wrong = AccountFactory.createInterPosAccount('vakif-katilim', 's', 'u', 'p', 'k')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [vakif-katilim] is configured for VakifKatilimPos and needs a BoaPosAccount.',
    )
  })

  it('creates the tosla ToslaPos gateway from the shipped test config', () => {
    const account = AccountFactory.createToslaPosAccount(
      'tosla',
      '1000000494',
      'POS_ENT_Test_001',
      'POS_ENT_Test_001!*!*',
    )
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(ToslaPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies()).toHaveLength(6)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-Tosla account for a ToslaPos bank', () => {
    const wrong = AccountFactory.createAkbankPosAccount('tosla', 'm', 't', 'k')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [tosla] is configured for ToslaPos and needs a ToslaPosAccount.',
    )
  })

  it('creates the param-pos ParamPos gateway from the shipped test config', () => {
    const account = AccountFactory.createParamPosAccount(
      'param-pos',
      '10738',
      'Test1',
      'Test2',
      '0c13d406-873b-403b-9c09-a5766840d98c',
    )
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(ParamPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies()).toHaveLength(4)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-Param account for a ParamPos bank', () => {
    const wrong = AccountFactory.createToslaPosAccount('param-pos', '1', 'u', 'p')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [param-pos] is configured for ParamPos and needs a ParamPosAccount.',
    )
  })

  // addition: P13 the confirmation of a 3D Pay approval goes to the shipped TurkPos endpoint
  it('sends the ParamPos confirmation to the shipped TurkPos endpoint', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url))
      return new Response(
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TP_Islem_Sorgulama4Response><TP_Islem_Sorgulama4Result><Sonuc>-1</Sonuc></TP_Islem_Sorgulama4Result></TP_Islem_Sorgulama4Response></soap:Body></soap:Envelope>',
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const account = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', 'g')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    await gateway.status({ id: 'o1' })
    expect(urls).toStrictEqual(['https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx'])
  })

  it('creates the paytr PayTrPos gateway from the shipped test config', () => {
    const account = AccountFactory.createPayTrPosAccount('paytr', '123456', 'salt', 'key')
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(PayTrPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies()).toStrictEqual(['TRY', 'USD', 'EUR', 'GBP', 'RUB'])
    expect(gateway.isTestMode()).toBe(true)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-PayTR account for a PayTrPos bank', () => {
    const wrong = AccountFactory.createToslaPosAccount('paytr', '1', 'u', 'p')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [paytr] is configured for PayTrPos and needs a PayTrPosAccount.',
    )
  })

  // addition: G7 the shipped test entry selects test transactions: the iFrame token request carries test_mode 1
  it('sends the PayTrPos token request with test_mode 1 from the shipped test config', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ status: 'success', token: 'tok1' }), { status: 200 })
    }) as unknown as typeof fetch
    const account = AccountFactory.createPayTrPosAccount('paytr', '123456', 'salt', 'key')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const order: PosOrder = {
      id: 'O1',
      amount: 1.01,
      ip: '127.0.0.1',
      success_url: 'https://example.com/ok',
      fail_url: 'https://example.com/fail',
      buyer: { email: 'test@example.com', name: 'John Doe', gsm_number: '05001234567' },
      billing_address: { address: 'Test Sokak No:1 Istanbul' },
    }
    const form = await gateway.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
    expect(form).toStrictEqual({ gateway: 'https://www.paytr.com/odeme/guvenli/tok1', method: 'GET', inputs: {} })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://www.paytr.com/odeme/api/get-token')
    const sent = new URLSearchParams(calls[0]?.body)
    expect(sent.get('test_mode')).toBe('1')
    expect(sent.get('lang')).toBe('tr')
    expect(calls[0]?.body).not.toContain('salt')
  })

  it('creates the param-3d-host-pos Param3DHostPos gateway from the shipped test config', () => {
    const account = AccountFactory.createParamPosAccount(
      'param-3d-host-pos',
      '10738',
      'Test1',
      'Test2',
      '0c13d406-873b-403b-9c09-a5766840d98c',
      '99001',
    )
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(Param3DHostPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
  })

  // addition: H1 the hosted page needs the terminal id; it fails at construction
  it('rejects a Param account without terminal id for a Param3DHostPos bank', () => {
    const account = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', 'g')
    expect(() => PosFactory.createPosGateway(account, posTestConfig)).toThrow(MissingAccountInfoError)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-Param account for a Param3DHostPos bank', () => {
    const wrong = AccountFactory.createToslaPosAccount('param-3d-host-pos', '1', 'u', 'p')
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(wrong, posTestConfig)).toThrow(
      'Bank [param-3d-host-pos] is configured for Param3DHostPos and needs a ParamPosAccount.',
    )
  })

  // addition: H4/H6 the registration goes to the hosted page service, the confirmation to the TurkPos service
  it('sends the Param3DHostPos registration and confirmation to the shipped endpoints', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url))
      return new Response(
        String(url).includes('turkpos.ws')
          ? '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TP_Islem_Sorgulama4Response><TP_Islem_Sorgulama4Result><Sonuc>-1</Sonuc></TP_Islem_Sorgulama4Result></TP_Islem_Sorgulama4Response></soap:Body></soap:Envelope>'
          : '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TO_Pre_Encrypting_OOSResponse><TO_Pre_Encrypting_OOSResult>QUJD</TO_Pre_Encrypting_OOSResult></TO_Pre_Encrypting_OOSResponse></soap:Body></soap:Envelope>',
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const guid = '0c13d406-873b-403b-9c09-a5766840d98c'
    const account = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', guid, '99001')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const order: PosOrder = { id: 'order222', amount: 10.01, success_url: 'https://domain.com/success' }
    const form = await gateway.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
    expect(form).toStrictEqual({
      gateway: 'https://test-pos.param.com.tr/default.aspx',
      method: 'GET',
      inputs: { s: 'QUJD' },
    })
    const callback = {
      TURKPOS_RETVAL_Sonuc: '1',
      TURKPOS_RETVAL_Dekont_ID: '3007300695',
      TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
      TURKPOS_RETVAL_Siparis_ID: '20250119BACB',
      TURKPOS_RETVAL_Islem_ID: '1944A39AD0AEA92E173D665B',
      TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
    }
    await expect(gateway.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callback)).rejects.toThrow(
      'Callback order_status mismatch',
    )
    expect(urls).toStrictEqual([
      'https://test-pos.param.com.tr/to.ws/Service_Odeme.asmx',
      'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    ])
  })

  // addition: T18 status goes to the Tosla inquiry path, with a request hash and without the API password
  it('sends a ToslaPos status to inquiry', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: Buffer.from(init?.body as Uint8Array).toString('utf8') })
      return new Response(JSON.stringify({ Code: 1, Message: 'x' }), { status: 200 })
    }) as unknown as typeof fetch
    const account = AccountFactory.createToslaPosAccount(
      'tosla',
      '1000000494',
      'POS_ENT_Test_001',
      'POS_ENT_Test_001!*!*',
    )
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const result = await gateway.status({ id: '202401199AAA' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${posTestConfig.banks.tosla.gateway_endpoints.payment_api}/inquiry`)
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.orderId).toBe('202401199AAA')
    expect(body.hash).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    expect(calls[0]?.body).not.toContain('POS_ENT_Test_001!*!*')
    expect(result.status).toBe('declined')
  })

  // addition: V6 status goes to the Vakıf Katılım gateway path, signed with the account's hashed password
  it('sends a VakifKatilimPos status to SelectOrderByMerchantOrderId', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: Buffer.from(init?.body as Uint8Array).toString('latin1') })
      return new Response('<VPosOrderDataResponse><ResponseCode>NonResult</ResponseCode></VPosOrderDataResponse>', {
        status: 200,
      })
    }) as unknown as typeof fetch
    const account = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const result = await gateway.status({ id: '2023070849CD' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      `${posTestConfig.banks['vakif-katilim'].gateway_endpoints.payment_api}/SelectOrderByMerchantOrderId`,
    )
    expect(calls[0]?.body).toContain('<MerchantOrderId>2023070849CD</MerchantOrderId>')
    expect(calls[0]?.body).not.toContain('kdsnsksl')
    expect(result.status).toBe('declined')
  })

  // addition: K6 status goes to the SOAP query endpoint, signed with the account's hashed password
  it('sends a KuveytPos status to the Kuveyt test SOAP endpoint', async () => {
    const calls: { url: string; headers: Headers; body: string }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) })
      return new Response(
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetMerchantOrderDetailResponse/></s:Body></s:Envelope>',
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const account = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', 'Api123')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl })
    const result = await gateway.status({ id: '2023070849CD' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(posTestConfig.banks.kuveytpos.gateway_endpoints.query_api)
    expect(calls[0]?.headers.get('SOAPAction')).toBe(
      'http://boa.net/BOA.Integration.VirtualPos/Service/IVirtualPosService/GetMerchantOrderDetail',
    )
    expect(calls[0]?.body).toContain('<ser:MerchantOrderId>2023070849CD</ser:MerchantOrderId>')
    expect(calls[0]?.body).not.toContain('Api123')
    expect(result.status).toBe('declined')
  })

  it('creates an AkbankPos gateway from the shipped test config', () => {
    const account = akbankAccount()
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(AkbankPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCardTypeMapping()).toStrictEqual({})
    expect(gateway.getCurrencies().length).toBeGreaterThan(0)
  })

  it('creates an AkbankPos gateway with only the required parameters', () => {
    const cfg: PosConfig = {
      banks: {
        'akbank-pos': {
          name: 'Akbank',
          class: 'AkbankPos',
          gateway_endpoints: {
            payment_api: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
            gateway_3d: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
            gateway_3d_host: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
          },
        },
      },
    }
    expect(PosFactory.createPosGateway(akbankAccount(), cfg)).toBeInstanceOf(AkbankPos)
  })

  // deviation: A22 the missing endpoint is a PosError
  it('rejects an AkbankPos config without endpoints', () => {
    const cfg: PosConfig = {
      banks: { 'akbank-pos': { name: 'Akbank', class: 'AkbankPos', gateway_endpoints: {} as never } },
    }
    expect(() => PosFactory.createPosGateway(akbankAccount(), cfg)).toThrow(PosError)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-Akbank account for AkbankPos', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('akbank-pos'), posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('akbank-pos'), posTestConfig)).toThrow(/AkbankPosAccount/)
  })

  // addition: a request built through the factory is signed with the account's secret key
  it('signs an AkbankPos cancel request end to end', async () => {
    const sent: { url: string; body: string; hash: string | null }[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      sent.push({
        url: String(url),
        body: String(init?.body),
        hash: new Headers(init?.headers).get('auth-hash'),
      })
      return new Response('{"responseCode":"VPS-0000","responseMessage":"ok"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(akbankAccount(), posTestConfig, { fetch: fetchImpl })
    await gateway.cancel({ id: 'o' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://apipre.akbank.com/api/v1/payment/virtualpos/transaction/process')
    const expected = createHmac('sha512', Buffer.from('k', 'utf8'))
      .update(sent[0]?.body ?? '', 'utf8')
      .digest('base64')
    expect(sent[0]?.hash).toBe(expected)
  })

  // addition: the account type must fit the gateway
  it('rejects a non-Garanti account for GarantiPos', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('garanti'), posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('garanti'), posTestConfig)).toThrow(/GarantiPosAccount/)
  })

  // addition: the testMode option overrides the config and reaches the request body
  it('lets the testMode option switch GarantiPos to production mode', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return new Response('<GVPSResponse/>', { status: 200 })
    }) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(garantiAccount(), posTestConfig, { testMode: false, fetch: fetchImpl })
    expect(gateway.isTestMode()).toBe(false)
    await gateway.status({ id: 'o1', currency: CURRENCY.TRY, amount: 1, ip: '127.0.0.1' }).catch(() => undefined)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('<Mode>PROD</Mode>')
  })

  it('rejects a non-PayFlex account for PayFlexCPV4Pos', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('vakifbank-cp'), posTestConfig)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('vakifbank-cp'), posTestConfig)).toThrow(/PayFlexPosAccount/)
  })

  it('rejects an http: payment_api override for PayFlexCPV4Pos', () => {
    const bank = posTestConfig.banks['vakifbank-cp'] as GatewayConfig
    const cfg: PosConfig = {
      banks: {
        'vakifbank-cp': { ...bank, gateway_endpoints: { payment_api: 'http://pay.example.com/commonPayment' } },
      },
    }
    expect(() => PosFactory.createPosGateway(payFlexAccount('vakifbank-cp'), cfg)).toThrow(PosError)
  })

  it('throws GatewayClassNotConfiguredError when the bank is not in the config', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('unknown-bank'), config)).toThrow(
      GatewayClassNotConfiguredError,
    )
    // prototype keys are not banks
    expect(() => PosFactory.createPosGateway(assecoAccount('constructor'), config)).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('throws GatewayClassNotConfiguredError for an unknown gateway class', () => {
    const bad: PosConfig = { banks: { asseco: { ...assecoCfg, class: 'UnknownPos' } } }
    expect(() => PosFactory.createPosGateway(assecoAccount(), bad)).toThrow(GatewayClassNotConfiguredError)
  })

  it('rejects an account of the wrong type for the configured gateway', () => {
    expect(() => PosFactory.createPosGateway(payFlexAccount('asseco'), config)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('vakifbank'), config)).toThrow(PosError)
  })

  it('requires the PayFlex gateway_3d and query_api endpoints', () => {
    const bad: PosConfig = {
      banks: { vakifbank: { ...vakifCfg, gateway_endpoints: { payment_api: 'https://a.example.com' } } },
    }
    expect(() => PosFactory.createPosGateway(payFlexAccount(), bad)).toThrow(PosError)
  })

  it.each([
    ['asseco', 'payment_api', 'http://entegrasyon.asseco-see.com.tr/fim/api'],
    ['asseco', 'gateway_3d', 'http://entegrasyon.asseco-see.com.tr/fim/est3Dgate'],
    ['asseco', 'gateway_3d_host', 'ftp://example.com/host'],
    ['vakifbank', 'query_api', 'HTTP://pay.example.com/Search'],
    ['vakifbank', 'gateway_3d', 'not a url'],
  ] as const)('rejects a non-https %s %s endpoint', (bank, key, url) => {
    const bankConfig = config.banks[bank] as GatewayConfig
    const cfg: PosConfig = {
      banks: { [bank]: { ...bankConfig, gateway_endpoints: { ...bankConfig.gateway_endpoints, [key]: url } } },
    }
    const account = bank === 'asseco' ? assecoAccount() : payFlexAccount()
    const create = () => PosFactory.createPosGateway(account, cfg)
    expect(create).toThrow(PosError)
    expect(create).toThrow(`Endpoint [${key}]`)
    expect(create).toThrow('must be an https: URL')
  })

  it('accepts https endpoints in any letter case', () => {
    const bankConfig = config.banks.asseco as GatewayConfig
    const cfg: PosConfig = {
      banks: {
        asseco: {
          ...bankConfig,
          gateway_endpoints: { ...bankConfig.gateway_endpoints, payment_api: 'HTTPS://example.com/api' },
        },
      },
    }
    expect(PosFactory.createPosGateway(assecoAccount(), cfg)).toBeInstanceOf(AssecoPos)
  })

  it('options.testMode overrides the config test_mode', () => {
    const cfg: PosConfig = { banks: { asseco: { ...assecoCfg, test_mode: false } } }
    expect(PosFactory.createPosGateway(assecoAccount(), cfg, { testMode: true }).isTestMode()).toBe(true)
    const cfgTest: PosConfig = { banks: { asseco: { ...assecoCfg, test_mode: true } } }
    expect(PosFactory.createPosGateway(assecoAccount(), cfgTest).isTestMode()).toBe(true)
  })

  it('passes config.lang to the request mapper as default language', async () => {
    const cfg: PosConfig = { banks: { asseco: { ...assecoCfg, lang: LANG.EN } } }
    const gateway = PosFactory.createPosGateway(assecoAccount(), cfg)
    const order: PosOrder = {
      id: 'o1',
      amount: 1,
      currency: CURRENCY.TRY,
      installment: 0,
      success_url: 'https://x.test/ok',
      fail_url: 'https://x.test/fail',
    }
    const form = await gateway.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null, true)
    expect(typeof form).toBe('object')
    expect((form as { inputs: Record<string, string> }).inputs.lang).toBe('en')
  })

  it('uses the injected fetch / transport and wraps the logger', async () => {
    const body = '<CC5Response><Response>Approved</Response><ProcReturnCode>00</ProcReturnCode></CC5Response>'
    const fetchSpy = vi.fn(async () => new Response(body, { status: 200 }))
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { fetch: fetchSpy as unknown as typeof fetch })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe('https://entegrasyon.asseco-see.com.tr/fim/api')

    const transport = new HttpTransport({ fetch: fetchSpy as unknown as typeof fetch })
    const post = vi.spyOn(transport, 'post')
    const gw2 = PosFactory.createPosGateway(assecoAccount(), config, { transport })
    await gw2.status({ id: 'o1' }).catch(() => undefined)
    expect(post).toHaveBeenCalled()
  })

  it('masks sensitive data before it reaches a user logger', async () => {
    const logs: unknown[] = []
    const logger = {
      debug: (_m: string, c?: unknown) => logs.push(c),
      info: (_m: string, c?: unknown) => logs.push(c),
      warn: (_m: string, c?: unknown) => logs.push(c),
      error: (_m: string, c?: unknown) => logs.push(c),
    }
    const fetchImpl = (async () => new Response('<CC5Response/>', { status: 200 })) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { logger, fetch: fetchImpl, testMode: true })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('"k"') // account secret key never logged
  })

  it('wires hooks into the request data mapper', async () => {
    const seen: string[] = []
    const hooks: PosHooks = { onRequestDataPrepared: [(e) => void seen.push(e.txType)] }
    const fetchImpl = (async () => new Response('<CC5Response/>', { status: 200 })) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { hooks, fetch: fetchImpl })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(seen).toEqual([TX_TYPE.STATUS])
  })

  it('builds a gateway for every entry of the test config', () => {
    const accounts = {
      AssecoPos: (bank: string) => assecoAccount(bank),
      PayFlexV4Pos: (bank: string) => payFlexAccount(bank),
      PayFlexCPV4Pos: (bank: string) => payFlexAccount(bank),
      AkbankPos: (bank: string) => AccountFactory.createAkbankPosAccount(bank, 'm', 't', 'k'),
      GarantiPos: (bank: string) => AccountFactory.createGarantiPosAccount(bank, 'm', 'u', 'p', 't', 'k'),
      PosNetPos: (bank: string) => AccountFactory.createPosNetPosAccount(bank, 'm', 't', 'p', 'k'),
      PosNetV1Pos: (bank: string) => AccountFactory.createPosNetPosAccount(bank, 'm', 't', 'p', 'k'),
      PayForPos: (bank: string) => AccountFactory.createPayForPosAccount(bank, 'm', 'u', 'p', 'k'),
      InterPos: (bank: string) => AccountFactory.createInterPosAccount(bank, 's', 'u', 'p', 'k'),
      KuveytPos: (bank: string) => AccountFactory.createBoaPosAccount(bank, '1', 'u', '2', 'p'),
      VakifKatilimPos: (bank: string) => AccountFactory.createBoaPosAccount(bank, '1', 'u', '2', 'p'),
      ToslaPos: (bank: string) => AccountFactory.createToslaPosAccount(bank, '1', 'u', 'p'),
      ParamPos: (bank: string) => AccountFactory.createParamPosAccount(bank, '1', 'u', 'p', 'g'),
      Param3DHostPos: (bank: string) => AccountFactory.createParamPosAccount(bank, '1', 'u', 'p', 'g', 't'),
      PayTrPos: (bank: string) => AccountFactory.createPayTrPosAccount(bank, '1', 's', 'k'),
    } as const
    const entries = Object.entries(posTestConfig.banks)
    expect(entries.length).toBeGreaterThan(0)
    for (const [bank, bankConfig] of entries) {
      const makeAccount = accounts[bankConfig.class as keyof typeof accounts]
      const gateway = PosFactory.createPosGateway(makeAccount(bank), posTestConfig)
      expect((gateway.constructor as typeof AbstractGateway).GATEWAY_CLASS).toBe(bankConfig.class)
    }
  })
})
