import { faultMessage } from '../../../client/soapFault.js'
import { ORDER_ID_PATTERN, type ParamPosCrypt } from '../../../crypt/ParamPosCrypt.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../errors.js'
import type { ParamPosAccount } from '../../../model/account/ParamPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { toKurus } from '../../../util/toKurus.js'
import type { ParamPosRequestValueFormatter } from '../value-formatter/ParamPosRequestValueFormatter.js'
import type { ParamPosRequestValueMapper } from '../value-mapper/ParamPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'
import {
  accountData,
  envelope,
  isRecord,
  orderAmount,
  orderValue,
  readOrderId,
  returnUrl,
  XMLNS,
} from './paramRequestFields.js'

const HOSTED_XMLNS = 'https://turkodeme.com.tr/'

/** The encrypted value the bank returns for the hosted page: plain base64, as long as the bank itself writes it. */
const ENCRYPTED_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const ENCRYPTED_LIMIT = 8192

/** How much of a bank error text is kept in an error message. */
const BANK_TEXT_LIMIT = 256

/**
 * Creates request data for the Param hosted payment page. The registration carries the account in a SOAP header and
 * no signature: the bank encrypts the registration and returns a value the payer's browser takes to the hosted page.
 * No card data is involved. The id the bank keeps for the payment is derived from the order, so a later status
 * record can be bound to the order again without stored state; every other request kind is not supported here.
 */
export class Param3DHostPosRequestDataMapper extends AbstractRequestDataMapper<ParamPosAccount> {
  constructor(
    protected override readonly valueMapper: ParamPosRequestValueMapper,
    protected override readonly valueFormatter: ParamPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: ParamPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'Param3DHostPos'
  }

  create3DPaymentRequestData(
    _account: ParamPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  /** The registration of a hosted payment; every value is validated before anything is built. */
  override create3DFormInitializeRequestData(
    account: ParamPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    _creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    this.assertSale(txType)

    // The order id is not sent, but it is what the payment id is derived from.
    const orderId = readOrderId(order)
    const amount = orderAmount(this.valueFormatter, order, txType)
    const kurus = toKurus(parseOrderAmount(orderValue(order, 'amount')))
    const installment = this.valueFormatter.formatInstallment(parseInstallment(orderValue(order, 'installment')))
    const currency = this.currencyOf(order)
    const successUrl = returnUrl(order, 'success_url')
    const terminalId = account.getTerminalId()
    const soapAction = this.valueMapper.mapTxType(txType, MODEL.THREE_D_HOST)

    const transactionId: unknown = this.crypt.create3DHostTransactionId(account, orderId, kurus, currency.code)
    if (typeof transactionId !== 'string' || transactionId === '') {
      throw new PosError('The transaction id is missing')
    }

    const body: Record<string, unknown> = {
      '@xmlns': HOSTED_XMLNS,
      // The hosted page shows these values read-only ("r|" prefix; "e|" would let the payer edit them).
      Borclu_Tutar: `r|${amount}`,
      Borclu_Odeme_Tip: 'r|Diğer',
      Borclu_AdSoyad: 'r|',
      Borclu_Aciklama: 'r|',
      Return_URL: `r|${successUrl}`,
      Islem_ID: transactionId,
      Borclu_Kisi_TC: '',
      Terminal_ID: terminalId,
      Borclu_GSM: 'r|',
      // 1 lists a single payment, a larger value lists only that installment option.
      Taksit: installment,
    }
    if (currency.foreign) {
      body.Doviz_Kodu = currency.code
    }

    return {
      'soap:Header': {
        ServiceSecuritySoapHeader: {
          '@xmlns': HOSTED_XMLNS,
          CLIENT_CODE: account.getMerchantId(),
          CLIENT_USERNAME: account.getUsername(),
          CLIENT_PASSWORD: account.getPassword(),
        },
      },
      'soap:Body': { [soapAction]: body },
    }
  }

  createNonSecurePaymentRequestData(
    _account: ParamPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _creditCard: CreditCard,
  ): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  createNonSecurePostAuthPaymentRequestData(_account: ParamPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  createStatusRequestData(_account: ParamPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  createCancelRequestData(_account: ParamPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  createRefundRequestData(_account: ParamPosAccount, _order: PosOrder, _refundTxType: TxType): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  createOrderHistoryRequestData(_account: ParamPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported by the hosted payment page.')
  }

  /**
   * The request that looks a paid order up at the bank's payment service: the hosted page has no status request of
   * its own, so an approval is confirmed from the bank's record of the order the callback names.
   */
  createConfirmationRequestData(account: ParamPosAccount, siparisId: string): Record<string, unknown> {
    if (typeof siparisId !== 'string' || !ORDER_ID_PATTERN.test(siparisId)) {
      throw new PosError('The order id to confirm is not valid.')
    }

    return envelope({
      TP_Islem_Sorgulama4: {
        ...accountData(account),
        '@xmlns': XMLNS,
        Siparis_ID: siparisId,
      },
    })
  }

  /** The payer's browser is sent to the hosted page with the bank's encrypted value as the only input. */
  async create3DFormData(
    account: ParamPosAccount,
    _order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    _creditCard: CreditCard | null = null,
    extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData | string> {
    if (extraData === null || extraData === undefined) {
      throw new PosError('The 3D form answer is missing')
    }
    if (paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model for the 3D form: ${String(paymentModel)}`)
    }
    this.assertSale(txType)
    if (typeof gatewayURL !== 'string' || !/^https:\/\/[\x21-\x7E]+$/i.test(gatewayURL)) {
      throw new PosError('The hosted payment page address must be an https URL.')
    }

    const response: unknown = isRecord(extraData) ? ownValue(extraData, 'TO_Pre_Encrypting_OOSResponse') : undefined
    const result: unknown = isRecord(response) ? ownValue(response, 'TO_Pre_Encrypting_OOSResult') : undefined
    if (typeof result !== 'string') {
      throw new PosError('3D form could not be created: the bank answer has no result')
    }
    if (
      result.length === 0 ||
      result.length > ENCRYPTED_LIMIT ||
      result.length % 4 !== 0 ||
      !ENCRYPTED_PATTERN.test(result)
    ) {
      // The bank answers a refused registration with a plain text (an access error, for one), so show it, masked.
      throw new PosError(`3D form could not be created: ${faultMessage(result, secretsOf(account), BANK_TEXT_LIMIT)}`)
    }

    return { gateway: gatewayURL, method: 'GET', inputs: { s: result } }
  }

  /** The currency of the order (TRY when absent) with its bank code; TRY is not sent as `Doviz_Kodu`. */
  private currencyOf(order: PosOrder): { code: string; foreign: boolean } {
    const currency: unknown = orderValue(order, 'currency') ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }
    return { code: String(this.valueMapper.mapCurrency(currency as never)), foreign: currency !== CURRENCY.TRY }
  }

  private assertSale(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }
}

function secretsOf(account: ParamPosAccount): string[] {
  return [account.getPassword(), account.getSecretKey()]
}
