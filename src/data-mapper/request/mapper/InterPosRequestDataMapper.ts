import type { InterPosCrypt } from '../../../crypt/InterPosCrypt.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../errors.js'
import type { InterPosAccount } from '../../../model/account/InterPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { required } from '../../../util/required.js'
import type { InterPosRequestValueFormatter } from '../value-formatter/InterPosRequestValueFormatter.js'
import type { InterPosRequestValueMapper } from '../value-mapper/InterPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'InterPos'

/** MOTO (mail order / telephone order): '0' for false. */
const MOTO = '0'

/** Order ids are signed and posted as plain ASCII: letters, digits, underscore and hyphen, at most 64 characters. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Creates request data for the InterPos form API and the 3D form (Denizbank). */
export class InterPosRequestDataMapper extends AbstractRequestDataMapper<InterPosAccount> {
  constructor(
    protected override readonly valueMapper: InterPosRequestValueMapper,
    protected override readonly valueFormatter: InterPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: InterPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  /**
   * The provision request after a successful 3D authentication. The order values come from the order; the
   * authentication values (`MD`, `PayerTxnId`, `Eci`, `PayerAuthenticationCode`) come from the callback and must be
   * own strings there.
   */
  create3DPaymentRequestData(
    account: InterPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    this.assertPaymentTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.amount(order)
    const md = this.callbackText(responseData, 'MD', false)
    const payerTxnId = this.callbackText(responseData, 'PayerTxnId')
    const eci = this.callbackText(responseData, 'Eci')
    const payerAuthenticationCode = this.callbackText(responseData, 'PayerAuthenticationCode')

    return {
      ...this.accountData(account),
      TxnType: this.valueMapper.mapTxType(txType),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      OrderId: orderId,
      PurchAmount: amount,
      Currency: this.currency(order),
      InstallmentCount: this.installment(order),
      MD: md,
      PayerTxnId: payerTxnId,
      Eci: eci,
      PayerAuthenticationCode: payerAuthenticationCode,
      MOTO,
      Lang: this.getLang(order),
    }
  }

  createNonSecurePaymentRequestData(
    account: InterPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertPaymentTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.amount(order)
    const cardType = creditCard.getType()

    return {
      ...this.accountData(account),
      TxnType: this.valueMapper.mapTxType(txType),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      OrderId: orderId,
      PurchAmount: amount,
      Currency: this.currency(order),
      InstallmentCount: this.installment(order),
      MOTO,
      Lang: this.getLang(order),
      // A null value is left out when the request is encoded.
      CardType: cardType === null ? null : this.valueMapper.mapCardType(cardType),
      Pan: creditCard.getNumber(),
      Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
      Cvv2: creditCard.getCvv(),
    }
  }

  createNonSecurePostAuthPaymentRequestData(account: InterPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)
    const amount = this.amount(order)

    return {
      ...this.accountData(account),
      TxnType: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      OrderId: null,
      orgOrderId: orderId,
      PurchAmount: amount,
      Currency: this.currency(order),
      MOTO,
    }
  }

  createStatusRequestData(account: InterPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)

    return {
      ...this.accountData(account),
      OrderId: null,
      orgOrderId: orderId,
      TxnType: this.valueMapper.mapTxType(TX_TYPE.STATUS),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      Lang: this.getLang(order),
    }
  }

  createCancelRequestData(account: InterPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)

    return {
      ...this.accountData(account),
      OrderId: null,
      orgOrderId: orderId,
      TxnType: this.valueMapper.mapTxType(TX_TYPE.CANCEL),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      Lang: this.getLang(order),
    }
  }

  createRefundRequestData(account: InterPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type maps to another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = this.orderId(order)
    const amount = this.amount(order)

    return {
      ...this.accountData(account),
      OrderId: null,
      orgOrderId: orderId,
      PurchAmount: amount,
      TxnType: this.valueMapper.mapTxType(refundTxType),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      Lang: this.getLang(order),
      MOTO,
    }
  }

  createOrderHistoryRequestData(_account: InterPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Order history is not supported by this gateway.')
  }

  async create3DFormData(
    account: InterPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
  ): Promise<ThreeDFormData> {
    if (order === null || order === undefined) {
      throw new PosError('An order is required to create the 3D form.')
    }
    this.assertPaymentTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.amount(order)
    const okUrl = this.url(order, 'success_url')
    const failUrl = this.url(order, 'fail_url')

    let inputs: Record<string, string> = {
      ShopCode: account.getMerchantId(),
      TxnType: this.valueMapper.mapTxType(txType),
      SecureType: this.valueMapper.mapSecureType(paymentModel),
      PurchAmount: amount,
      OrderId: orderId,
      OkUrl: okUrl,
      FailUrl: failUrl,
      Rnd: this.crypt.generateRandomString(),
      Lang: this.getLang(order),
      Currency: this.currency(order),
      InstallmentCount: this.installment(order),
    }

    if (creditCard !== null && creditCard !== undefined) {
      const cardType = creditCard.getType()
      inputs = {
        ...inputs,
        CardType: cardType === null ? '' : this.valueMapper.mapCardType(cardType),
        Pan: creditCard.getNumber(),
        Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
        Cvv2: creditCard.getCvv(),
      }
    }

    // The hash covers what is posted, so it is computed after the hooks have run and is appended last.
    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )

    // The caller fills in the gateway URL.
    return {
      gateway: gatewayURL,
      method: 'POST',
      inputs: { ...inputs, Hash: this.crypt.create3DHash(account, inputs) },
    }
  }

  /** The API credentials come first in every API request. */
  private accountData(account: InterPosAccount): Record<string, string> {
    return {
      UserCode: account.getUsername(),
      UserPass: account.getPassword(),
      ShopCode: account.getMerchantId(),
    }
  }

  private assertPaymentTxType(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  private orderId(order: PosOrder): string {
    const id = String(required(order, 'id'))
    if (!ORDER_ID_PATTERN.test(id)) {
      throw new PosError('The order id may only hold letters, digits, underscores and hyphens (at most 64).')
    }
    return id
  }

  /**
   * The amount as the bank writes it. A missing, non-numeric, non-positive amount, or one that rounds to zero
   * (below half a kuruş), never reaches the bank.
   */
  private amount(order: PosOrder): string {
    const amount = parseOrderAmount(required(order, 'amount'))
    if (!(amount > 0)) {
      throw new PosError('The order amount must be a positive number.')
    }
    const formatted = this.valueFormatter.formatAmount(amount)
    if (formatted === '0') {
      throw new PosError('The order amount must be at least 0.01.')
    }
    return formatted
  }

  private installment(order: PosOrder): string {
    return this.valueFormatter.formatInstallment(parseInstallment(order.installment))
  }

  private currency(order: PosOrder): string {
    return this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)
  }

  private url(order: PosOrder, key: 'success_url' | 'fail_url'): string {
    const value: unknown = required(order, key)
    if (typeof value !== 'string') {
      throw new PosError(`Order field "${key}" must be text`)
    }
    return value
  }

  /** A value of the 3D callback that is copied into the provision: an own string, never converted. */
  private callbackText(data: Record<string, unknown>, key: string, allowEmpty = true): string {
    const value: unknown = ownValue(data, key)
    if (typeof value !== 'string' || (value === '' && !allowEmpty)) {
      throw new PosError(`The 3D callback value "${key}" is missing or not text.`)
    }
    return value
  }
}
