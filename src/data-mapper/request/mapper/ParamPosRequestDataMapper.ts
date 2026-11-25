import type { ParamPosCrypt } from '../../../crypt/ParamPosCrypt.js'
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
import { isSet } from '../../../util/required.js'
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
  requestIp,
  returnUrl,
  XMLNS,
} from './paramRequestFields.js'

/** The bank's transaction GUID of a 3D Secure session. */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The bank's opaque 3D value, posted back as text. */
const MD_PATTERN = /^[\x21-\x7E]{1,1024}$/

/** Where the payer's browser is sent: https only, a host, a path, no userinfo, no fragment. */
const UCD_BASE_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/[\x21-\x7E]*$/
const UCD_KEY_PATTERN = /^[A-Za-z0-9_]{1,64}$/
const UCD_VALUE_LIMIT = 2048

/** The bank-built 3D page is kept whole; a page of this size is not a payment page. */
const HTML_LIMIT = 1_048_576

/**
 * Creates request data for Param SOAP requests. Every request is `{ 'soap:Body': { <operation>: body } }` and the
 * body starts with the account (`G`, `GUID`) and the operation's namespace. Money values come from the order and
 * are validated before anything is built; the 3D Secure provision takes only the session fields from the callback.
 * The registration signature covers the body that is sent. The payer's browser is sent to a page the bank builds,
 * so there is no form hash here.
 */
export class ParamPosRequestDataMapper extends AbstractRequestDataMapper<ParamPosAccount> {
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
    return gatewayClass === 'ParamPos'
  }

  /** The provision of an approved 3D Secure card check; the order id comes from the order, not the callback. */
  create3DPaymentRequestData(
    account: ParamPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    this.assertSaleTxType(txType)
    const orderId = readOrderId(order)
    orderAmount(this.valueFormatter, order, txType)
    const md = this.sessionField(responseData, 'md', MD_PATTERN)
    const islemGuid = this.sessionField(responseData, 'islemGUID', GUID_PATTERN)

    return envelope({
      TP_WMD_Pay: {
        ...accountData(account),
        '@xmlns': XMLNS,
        UCD_MD: md,
        Islem_GUID: islemGuid,
        Siparis_ID: orderId,
      },
    })
  }

  /** The registration of a 3D Secure, 3D Pay or foreign currency 3D payment; the answer carries the page to show. */
  override create3DFormInitializeRequestData(
    account: ParamPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (paymentModel !== MODEL.THREE_D_SECURE && paymentModel !== MODEL.THREE_D_PAY) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    this.assertSaleTxType(txType)
    if (creditCard === null || creditCard === undefined) {
      throw new PosError('Card data is required for this payment model')
    }
    const values = this.paymentValues(order, txType, true)
    const soapAction = this.soapActionOf(order, paymentModel, txType)
    const expMonth = this.valueFormatter.formatCardExpDate(creditCard, 'KK_SK_Ay')
    const expYear = this.valueFormatter.formatCardExpDate(creditCard, 'KK_SK_Yil')

    const body: Record<string, unknown> = {
      ...accountData(account),
      '@xmlns': XMLNS,
      Islem_Guvenlik_Tip: this.valueMapper.mapSecureType(paymentModel),
      Islem_ID: this.transactionId(),
      IPAdr: values.ip,
      Siparis_ID: values.orderId,
      Islem_Tutar: values.amount,
      Toplam_Tutar: values.amount,
      Basarili_URL: values.successUrl,
      Hata_URL: values.failUrl,
      Taksit: values.installment,
      ...this.cardFields(creditCard, expMonth, expYear),
    }
    if (values.currencyCode !== null) {
      body.Doviz_Kodu = values.currencyCode
    }

    return this.signed(account, soapAction, body)
  }

  createNonSecurePaymentRequestData(
    account: ParamPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertSaleTxType(txType)
    const values = this.paymentValues(order, txType, false)
    const expMonth = this.valueFormatter.formatCardExpDate(creditCard, 'KK_SK_Ay')
    const expYear = this.valueFormatter.formatCardExpDate(creditCard, 'KK_SK_Yil')
    // A pre-authorization always uses its own operation, also in a foreign currency.
    const soapAction = this.soapActionOf(order, MODEL.NON_SECURE, txType)

    const body: Record<string, unknown> = {
      ...accountData(account),
      '@xmlns': XMLNS,
      Islem_Guvenlik_Tip: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      Islem_ID: this.transactionId(),
      IPAdr: values.ip,
      Siparis_ID: values.orderId,
      Islem_Tutar: values.amount,
      Toplam_Tutar: values.amount,
      Taksit: values.installment,
      ...this.cardFields(creditCard, expMonth, expYear),
    }
    if (values.currencyCode !== null) {
      body.Doviz_Kodu = values.currencyCode
    }
    // The signatures of a foreign currency sale and of a pre-authorization cover the return URLs.
    if (values.currencyCode !== null || txType === TX_TYPE.PAY_PRE_AUTH) {
      body.Basarili_URL = values.successUrl
      body.Hata_URL = values.failUrl
    }

    return this.signed(account, soapAction, body)
  }

  createNonSecurePostAuthPaymentRequestData(account: ParamPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = readOrderId(order)
    const amount = orderAmount(this.valueFormatter, order, TX_TYPE.PAY_POST_AUTH)

    return envelope({
      [this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH)]: {
        ...accountData(account),
        '@xmlns': XMLNS,
        Prov_ID: '',
        Prov_Tutar: amount,
        Siparis_ID: orderId,
      },
    })
  }

  createStatusRequestData(account: ParamPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = readOrderId(order)

    return envelope({
      [this.valueMapper.mapTxType(TX_TYPE.STATUS)]: {
        ...accountData(account),
        '@xmlns': XMLNS,
        Siparis_ID: orderId,
      },
    })
  }

  /** Cancelling a sale needs the amount (a missing one would be sent as zero); a pre-authorization is cancelled whole. */
  createCancelRequestData(account: ParamPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = readOrderId(order)
    const original = this.originalTxType(order)

    if (original === TX_TYPE.PAY_PRE_AUTH) {
      return envelope({
        [this.valueMapper.mapTxType(TX_TYPE.CANCEL, null, { transaction_type: original })]: {
          ...accountData(account),
          '@xmlns': XMLNS,
          Prov_ID: null,
          Siparis_ID: orderId,
        },
      })
    }

    const amount = orderAmount(this.valueFormatter, order, TX_TYPE.CANCEL)

    return envelope({
      [this.valueMapper.mapTxType(TX_TYPE.CANCEL, null, { transaction_type: original })]: {
        ...accountData(account),
        '@xmlns': XMLNS,
        Durum: 'IPTAL',
        Siparis_ID: orderId,
        Tutar: amount,
      },
    })
  }

  createRefundRequestData(account: ParamPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type is another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = readOrderId(order)
    const amount = orderAmount(this.valueFormatter, order, refundTxType)

    return envelope({
      [this.valueMapper.mapTxType(refundTxType)]: {
        ...accountData(account),
        '@xmlns': XMLNS,
        Durum: 'IADE',
        Siparis_ID: orderId,
        Tutar: amount,
      },
    })
  }

  createOrderHistoryRequestData(_account: ParamPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Param has no order history request.')
  }

  /**
   * What the payer's browser is sent to. `extraData` is the bank's registration answer: a 3D Secure page in Turkish
   * lira is returned as the bank-built HTML; 3D Pay and foreign currency payments are a redirect to an address the
   * answer names, which is checked again here (https, no fragment, plain query keys). The `gatewayURL` argument is
   * not used: the bank names the address itself.
   */
  async create3DFormData(
    _account: ParamPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    _gatewayURL: string,
    _creditCard: CreditCard | null = null,
    extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData | string> {
    if (extraData === null || extraData === undefined) {
      throw new PosError('The 3D form answer is missing')
    }
    if (paymentModel !== MODEL.THREE_D_SECURE && paymentModel !== MODEL.THREE_D_PAY) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model for the 3D form: ${String(paymentModel)}`)
    }
    this.assertSaleTxType(txType)
    const isPre = txType === TX_TYPE.PAY_PRE_AUTH
    if (isPre && paymentModel === MODEL.THREE_D_PAY) {
      throw new UnsupportedTransactionTypeError('Param 3D Pay has no pre-authorization')
    }
    const currency = this.currency(order)

    if (currency.code !== null || paymentModel === MODEL.THREE_D_PAY) {
      if (isPre) {
        throw new PosError('Param 3D pre-authorization supports TRY only')
      }
      const operation = currency.code !== null ? 'TP_Islem_Odeme_WD' : 'Pos_Odeme'
      return this.redirect(this.resultOf(extraData, operation))
    }

    const operation = isPre ? 'TP_Islem_Odeme_OnProv_WMD' : 'TP_WMD_UCD'
    const html: unknown = ownValue(this.resultOf(extraData, operation), 'UCD_HTML')
    if (typeof html !== 'string' || html === '') {
      throw new PosError('3D form could not be created: the bank sent no page')
    }
    if (html.length > HTML_LIMIT) {
      throw new PosError('3D form could not be created: the bank page is too large')
    }
    return html
  }

  /** The record `<operation>Response.<operation>Result` of the bank's answer. */
  private resultOf(answer: Record<string, unknown>, operation: string): Record<string, unknown> {
    const response: unknown = ownValue(answer, `${operation}Response`)
    const result: unknown = isRecord(response) ? ownValue(response, `${operation}Result`) : undefined
    if (!isRecord(result)) {
      throw new PosError('3D form could not be created: the bank answer has no result')
    }
    return result
  }

  private redirect(result: Record<string, unknown>): ThreeDFormData {
    const url: unknown = ownValue(result, 'UCD_URL')
    if (typeof url !== 'string' || url.includes('#')) {
      throw new PosError('3D form could not be created: the bank sent no valid address')
    }
    const separator = url.indexOf('?')
    if (separator < 0) {
      throw new PosError('3D form could not be created: the bank address has no query')
    }
    const base = url.slice(0, separator)
    const query = url.slice(separator + 1)
    if (!UCD_BASE_PATTERN.test(base) || base.includes('@')) {
      throw new PosError('3D form could not be created: the bank address is not valid')
    }

    const inputs: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(query)) {
      if (
        !UCD_KEY_PATTERN.test(key) ||
        key === '__proto__' ||
        Object.hasOwn(inputs, key) ||
        value.length > UCD_VALUE_LIMIT ||
        !/^[\x21-\x7E]*$/.test(value)
      ) {
        throw new PosError('3D form could not be created: the bank address query is not valid')
      }
      inputs[key] = value
    }
    if (Object.keys(inputs).length === 0) {
      throw new PosError('3D form could not be created: the bank address has no query')
    }

    return { gateway: base, method: 'GET', inputs }
  }

  /** The values of a sale or pre-authorization, all validated before anything is built. */
  private paymentValues(
    order: PosOrder,
    txType: TxType,
    needsUrls: boolean,
  ): {
    orderId: string
    amount: string
    installment: string
    ip: string
    currencyCode: string | null
    successUrl: string
    failUrl: string
  } {
    const orderId = readOrderId(order)
    const amount = orderAmount(this.valueFormatter, order, txType)
    const installment = this.valueFormatter.formatInstallment(parseInstallment(orderValue(order, 'installment')))
    const currency = this.currency(order)
    const ip = requestIp(order)
    const foreign = currency.code !== null
    const urls = needsUrls || foreign || txType === TX_TYPE.PAY_PRE_AUTH
    return {
      orderId,
      amount,
      installment,
      ip,
      currencyCode: currency.code,
      successUrl: urls ? returnUrl(order, 'success_url') : '',
      failUrl: urls ? returnUrl(order, 'fail_url') : '',
    }
  }

  /** The operation name; a foreign currency 3D pre-authorization has none (the bank would take it as a sale). */
  private soapActionOf(order: PosOrder, paymentModel: PaymentModel, txType: TxType): string {
    if (txType === TX_TYPE.PAY_PRE_AUTH) {
      if (paymentModel !== MODEL.NON_SECURE && this.currency(order).code !== null) {
        throw new PosError('Param 3D pre-authorization supports TRY only')
      }
      return this.valueMapper.mapTxType(txType, paymentModel)
    }
    return this.valueMapper.mapTxType(txType, paymentModel, order)
  }

  /** Appends the signature last; it covers the body as it is sent, without its own hash. */
  private signed(account: ParamPosAccount, soapAction: string, body: Record<string, unknown>): Record<string, unknown> {
    const hash = this.crypt.createHash(account, { [soapAction]: body })
    if (typeof hash !== 'string' || hash === '') {
      throw new PosError('The request signature is missing')
    }
    return envelope({ [soapAction]: { ...body, Islem_Hash: hash } })
  }

  private transactionId(): string {
    const id: unknown = this.crypt.generateRandomString()
    if (typeof id !== 'string' || id === '') {
      throw new PosError('The transaction id is missing')
    }
    return id
  }

  private cardFields(card: CreditCard, expMonth: string, expYear: string): Record<string, string> {
    return {
      KK_Sahibi: card.getHolderName() ?? '',
      KK_No: card.getNumber(),
      KK_SK_Ay: expMonth,
      KK_SK_Yil: expYear,
      KK_CVC: card.getCvv(),
      // Optional by the documentation, yet the bank answers with an error when it is not sent.
      KK_Sahibi_GSM: '',
    }
  }

  private assertSaleTxType(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  /** The kind of payment an order was made with; an order without one is a sale. */
  private originalTxType(order: PosOrder): TxType {
    const value: unknown = orderValue(order, 'transaction_type')
    if (!isSet(value)) {
      return TX_TYPE.PAY_AUTH
    }
    if (value !== TX_TYPE.PAY_AUTH && value !== TX_TYPE.PAY_PRE_AUTH) {
      throw new PosError('The order transaction type must be "pay" or "pre".')
    }
    return value
  }

  /** The currency of the order (TRY when absent) and its bank code when it is not Turkish lira. */
  private currency(order: PosOrder | null): { code: string | null } {
    const raw: unknown = order === null || order === undefined ? undefined : orderValue(order, 'currency')
    const currency: unknown = raw ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }
    const code = this.valueMapper.mapCurrency(currency as never)
    return { code: currency === CURRENCY.TRY ? null : String(code) }
  }

  /** A session field of the callback: an own string in the shape the bank uses, else the request is not built. */
  private sessionField(callback: Record<string, unknown>, name: string, pattern: RegExp): string {
    const value: unknown = isRecord(callback) ? ownValue(callback, name) : undefined
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new PosError(`3D callback field "${name}" is missing or malformed`)
    }
    return value
  }
}
