import type { PayForPosCrypt } from '../../../crypt/PayForPosCrypt.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../errors.js'
import type { PayForPosAccount } from '../../../model/account/PayForPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { orderIdOf } from '../../../util/orderId.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { required } from '../../../util/required.js'
import type { PayForPosRequestValueFormatter } from '../value-formatter/PayForPosRequestValueFormatter.js'
import type { PayForPosRequestValueMapper } from '../value-mapper/PayForPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'PayForPos'

/** MOTO (mail order / telephone order): '0' for false. */
const MOTO = '0'

/** Creates request data for the PayFor XML API and the 3D form (QNB Finansbank, Ziraat Katilim). */
export class PayForPosRequestDataMapper extends AbstractRequestDataMapper<PayForPosAccount> {
  constructor(
    protected override readonly valueMapper: PayForPosRequestValueMapper,
    protected override readonly valueFormatter: PayForPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: PayForPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  /**
   * The provision request after a successful 3D authentication. The order id comes from the order; only the
   * bank's request guid comes from the callback, and it must be an own string there.
   */
  create3DPaymentRequestData(
    account: PayForPosAccount,
    order: PosOrder,
    _txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const orderId = this.orderId(order)
    const requestGuid: unknown = ownValue(responseData, 'RequestGuid')
    if (typeof requestGuid !== 'string' || requestGuid === '') {
      throw new PosError('The 3D callback value "RequestGuid" is missing or not text.')
    }

    return {
      RequestGuid: requestGuid,
      UserCode: account.getUsername(),
      UserPass: account.getPassword(),
      OrderId: orderId,
      SecureType: '3DModelPayment',
    }
  }

  createNonSecurePaymentRequestData(
    account: PayForPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertPaymentTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.amount(order)

    return {
      ...this.accountData(account),
      MOTO,
      OrderId: orderId,
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      TxnType: this.valueMapper.mapTxType(txType),
      PurchAmount: amount,
      Currency: this.currency(order),
      InstallmentCount: this.installment(order),
      Lang: this.getLang(order),
      CardHolderName: creditCard.getHolderName() ?? '',
      Pan: creditCard.getNumber(),
      Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
      Cvv2: creditCard.getCvv(),
    }
  }

  createNonSecurePostAuthPaymentRequestData(account: PayForPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)
    const amount = this.amount(order)

    return {
      ...this.accountData(account),
      OrgOrderId: orderId,
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      TxnType: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
      PurchAmount: amount,
      Currency: this.currency(order),
      Lang: this.getLang(order),
    }
  }

  createStatusRequestData(account: PayForPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)

    return {
      ...this.accountData(account),
      OrgOrderId: orderId,
      SecureType: 'Inquiry',
      Lang: this.getLang(order),
      TxnType: this.valueMapper.mapTxType(TX_TYPE.STATUS),
    }
  }

  createCancelRequestData(account: PayForPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)

    return {
      ...this.accountData(account),
      OrgOrderId: orderId,
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      TxnType: this.valueMapper.mapTxType(TX_TYPE.CANCEL),
      Currency: this.currency(order),
      Lang: this.getLang(order),
    }
  }

  createRefundRequestData(account: PayForPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type maps to another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = this.orderId(order)
    const amount = this.amount(order)

    return {
      ...this.accountData(account),
      SecureType: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
      Lang: this.getLang(order),
      OrgOrderId: orderId,
      TxnType: this.valueMapper.mapTxType(refundTxType),
      PurchAmount: amount,
      Currency: this.currency(order),
    }
  }

  createOrderHistoryRequestData(account: PayForPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)

    return {
      ...this.accountData(account),
      SecureType: 'Report',
      OrderId: orderId,
      TxnType: this.valueMapper.mapTxType(QUERY_TYPE.HISTORY),
      Lang: this.getLang(order),
    }
  }

  async create3DFormData(
    account: PayForPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
  ): Promise<ThreeDFormData> {
    const inputs = await this.formInputs(account, order, paymentModel, txType, creditCard)

    // The caller fills in the gateway URL.
    return { gateway: gatewayURL, method: 'POST', inputs }
  }

  /** The 3D form values, hash included; the bank's 3D initialization endpoint takes the same fields. */
  override async create3DFormInitializeRequestData(
    account: PayForPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Promise<Record<string, string>> {
    return this.formInputs(account, order, paymentModel, txType, creditCard)
  }

  private async formInputs(
    account: PayForPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null,
  ): Promise<Record<string, string>> {
    if (order === null || order === undefined) {
      throw new PosError('An order is required to create the 3D form.')
    }
    this.assertPaymentTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.amount(order)
    const okUrl = this.url(order, 'success_url')
    const failUrl = this.url(order, 'fail_url')

    let inputs: Record<string, string> = {
      MbrId: account.getMbrId(),
      MerchantID: account.getMerchantId(),
      UserCode: account.getUsername(),
      OrderId: orderId,
      Lang: this.getLang(order),
      SecureType: this.valueMapper.mapSecureType(paymentModel),
      TxnType: this.valueMapper.mapTxType(txType),
      PurchAmount: amount,
      InstallmentCount: this.installment(order),
      Currency: this.currency(order),
      OkUrl: okUrl,
      FailUrl: failUrl,
      Rnd: this.crypt.generateRandomString(),
    }

    if (creditCard !== null && creditCard !== undefined) {
      inputs = {
        ...inputs,
        CardHolderName: creditCard.getHolderName() ?? '',
        Pan: creditCard.getNumber(),
        Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
        Cvv2: creditCard.getCvv(),
      }
    }

    // The hash covers what is posted, so it is computed after the hooks have run.
    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )

    return { ...inputs, Hash: this.crypt.create3DHash(account, inputs) }
  }

  private accountData(account: PayForPosAccount): Record<string, string> {
    return {
      MerchantId: account.getMerchantId(),
      UserCode: account.getUsername(),
      UserPass: account.getPassword(),
      MbrId: account.getMbrId(),
    }
  }

  private assertPaymentTxType(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  /** Order ids are signed and posted as plain ASCII (see `orderIdOf`). */
  private orderId(order: PosOrder): string {
    return orderIdOf(order)
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
}
