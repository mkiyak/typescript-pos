import { describe, expect, it } from 'vitest'
import { NullCrypt } from '../../../../../src/crypt/NullCrypt.js'
import { AbstractRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/AbstractRequestDataMapper.js'
import type { RequestValueFormatterInterface } from '../../../../../src/data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import { AbstractRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AbstractRequestValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { AssecoPosAccount } from '../../../../../src/model/account/AssecoPosAccount.js'
import { LANG, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../../../src/types.js'

class ValueMapper extends AbstractRequestValueMapper {
  protected override langMappings = { [LANG.TR]: 'tr', [LANG.EN]: 'en' }
}

const formatter: RequestValueFormatterInterface = {
  formatInstallment: (n) => String(n),
  formatAmount: (n) => String(n),
  formatCardExpDate: () => '',
  formatDateTime: () => '',
}

class TestMapper extends AbstractRequestDataMapper {
  create3DPaymentRequestData = () => ({})
  createNonSecurePaymentRequestData = () => ({})
  createNonSecurePostAuthPaymentRequestData = () => ({})
  createStatusRequestData = () => ({})
  createCancelRequestData = () => ({})
  createRefundRequestData = () => ({})
  createOrderHistoryRequestData = () => ({})
  async create3DFormData(
    account: AssecoPosAccount,
    _order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
  ): Promise<ThreeDFormData> {
    const inputs = await this.dispatchBefore3DFormHashCalculated(
      { a: '1' },
      account.getBankName(),
      txType,
      paymentModel,
      'TestGateway',
    )
    return {
      gateway: gatewayURL,
      method: 'POST',
      inputs: { ...inputs, hash: this.crypt.create3DHash(account, inputs) },
    }
  }
  lang(order: PosOrder): string {
    return this.getLang(order)
  }
}

const make = (hooks: PosHooks = {}, lang: (typeof LANG)[keyof typeof LANG] = LANG.TR) =>
  new TestMapper(new ValueMapper(), formatter, hooks, new NullCrypt(), lang)

describe('AbstractRequestDataMapper', () => {
  const account = new AssecoPosAccount('bank', 'merchant', 'user', 'pass', 'key')

  it('toggles test mode', () => {
    const m = make()
    expect(m.isTestMode()).toBe(false)
    m.setTestMode(true)
    expect(m.isTestMode()).toBe(true)
  })

  it('create3DFormInitializeRequestData is not supported by default', () => {
    expect(() => make().create3DFormInitializeRequestData(account, {}, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)).toThrow(
      NotImplementedError,
    )
  })

  it('getLang uses the order lang, then the default lang', () => {
    expect(make().lang({ lang: LANG.EN })).toBe('en')
    expect(make().lang({})).toBe('tr')
    expect(make({}, LANG.EN).lang({})).toBe('en')
  })

  it('runs onBefore3DFormHashCalculated hooks before the hash is computed', async () => {
    const seen: unknown[] = []
    const m = make({
      onBefore3DFormHashCalculated: [
        (e) => {
          seen.push({
            bankName: e.bankName,
            txType: e.txType,
            paymentModel: e.paymentModel,
            gatewayClass: e.gatewayClass,
          })
          e.formInputs.extra = 'x'
        },
        async (e) => {
          e.formInputs = { ...e.formInputs, replaced: 'y' }
        },
      ],
    })
    const form = await m.create3DFormData(account, {}, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://3d')
    expect(form.inputs).toEqual({ a: '1', extra: 'x', replaced: 'y', hash: '' })
    expect(seen).toEqual([{ bankName: 'bank', txType: 'pay', paymentModel: '3d', gatewayClass: 'TestGateway' }])
  })
})
