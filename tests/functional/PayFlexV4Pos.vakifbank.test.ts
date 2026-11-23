import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HttpClientStrategy } from '../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../src/client/HttpTransport.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { PayFlexV4PosCrypt } from '../../src/crypt/PayFlexV4PosCrypt.js'
import { PayFlexV4PosRequestDataMapper } from '../../src/data-mapper/request/mapper/PayFlexV4PosRequestDataMapper.js'
import { PayFlexV4PosRequestValueFormatter } from '../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueMapper } from '../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PayFlexV4PosResponseDataMapper } from '../../src/data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PayFlexV4PosResponseValueMapper } from '../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import type { GatewayConfig } from '../../src/gateway/AbstractGateway.js'
import { PayFlexV4Pos } from '../../src/gateway/PayFlexV4Pos.js'
import { PayFlexPosAccount } from '../../src/model/account/PayFlexPosAccount.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse } from '../../src/types.js'

// Runs against the public VakıfBank test environment (8443 API gateway). Skipped unless FUNCTIONAL_TESTS=1;
// never run in CI. Endpoints come from the shared test config.

const RUN = process.env.FUNCTIONAL_TESTS === '1'

const config: GatewayConfig = posTestConfig.banks.vakifbank as GatewayConfig

function createGateway(): PayFlexV4Pos {
  const account = AccountFactory.createPayFlexPosAccount(
    'vakifbank',
    '000000000011445',
    'Ab123456',
    'VP000265',
    PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER,
  )
  const crypt = new PayFlexV4PosCrypt()
  const valueMapper = new PayFlexV4PosRequestValueMapper()
  const valueFormatter = new PayFlexV4PosRequestValueFormatter()
  const transport = new HttpTransport({ timeoutMs: 30_000 })
  const endpoints = config.gateway_endpoints

  return new PayFlexV4Pos(config, account, {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PayFlexV4PosRequestDataMapper(valueMapper, valueFormatter, {}, crypt),
    responseDataMapper: new PayFlexV4PosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayFlexV4PosResponseValueMapper(),
    ),
    crypt,
    clientStrategy: new HttpClientStrategy([
      new PayFlexV4PosHttpClient(endpoints.payment_api, transport),
      new PayFlexV4Pos3DFormHttpClient(endpoints.gateway_3d as string, transport),
      new PayFlexV4PosSearchApiHttpClient(endpoints.query_api as string, transport),
    ]),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    hooks: {},
  })
}

const card = () => CreditCardFactory.create('4938410157705591', '29', '12', '453', 'John Doe', CARD_TYPE.VISA)

/** Public HTTPS callback URLs (the bank WAF rejected `http://localhost/...`). */
const newOrder = (): PosOrder => {
  const token = randomBytes(6).toString('hex')
  return {
    id: `TSPOS${token.toUpperCase()}`,
    amount: 10.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/payflex/success?t=${token}`,
    fail_url: `https://example.com/payflex/fail?t=${token}`,
  }
}

/** Bank codes only (no card data) for the run record; run with `--silent=false` to see them. */
const summary = (res: PosResponse) => ({
  status: res.status,
  proc_return_code: res.proc_return_code,
  error_code: res.error_code,
  error_message: res.error_message,
  order_id: res.order_id,
  transaction_id: res.transaction_id ?? null,
})

describe.skipIf(!RUN)('PayFlexV4Pos against the VakıfBank test environment', () => {
  const pos = createGateway()

  it('enrollment returns the ACS form (Status Y)', async () => {
    let form: Awaited<ReturnType<PayFlexV4Pos['get3DFormData']>>
    try {
      form = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    } catch (e) {
      console.info('[functional] enrollment failed', {
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      })
      throw e
    }
    // get3DFormData only returns a form for enrollment Status Y; only the ACS host is recorded
    console.info('[functional] enrollment', {
      status: 'Y',
      acs_host: new URL(form.gateway).host,
      inputs: Object.keys(form.inputs),
    })
    expect(form.gateway.startsWith('https://')).toBe(true)
    expect(Object.keys(form.inputs).sort()).toStrictEqual(['MD', 'PaReq', 'TermUrl'])
  }, 60_000)

  it('non-3D Sale followed by Cancel are approved', async () => {
    const order = newOrder()
    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const cancel = await pos.cancel({ transaction_id: sale.transaction_id as string, ip: '127.0.0.1' })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)
})
