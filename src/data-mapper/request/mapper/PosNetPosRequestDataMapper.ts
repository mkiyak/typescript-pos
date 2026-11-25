import type { PosNetMappedOrder, PosNetPosCrypt } from '../../../crypt/PosNetPosCrypt.js'
import { NotImplementedError, PosError } from '../../../errors.js'
import type { PosNetPosAccount } from '../../../model/account/PosNetPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { optionalBankReference, requiredBankReference } from '../../../util/bankReference.js'
import { orderIdOf } from '../../../util/orderId.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet, required } from '../../../util/required.js'
import type { PosNetPosRequestValueFormatter } from '../value-formatter/PosNetPosRequestValueFormatter.js'
import type { PosNetPosRequestValueMapper } from '../value-mapper/PosNetPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'PosNetPos'

/** The bank's order number field holds 20 characters. */
const ORDER_ID_LENGTH = 20

/** Creates request data for POSNET gateway requests. */
export class PosNetPosRequestDataMapper extends AbstractRequestDataMapper<PosNetPosAccount> {
  constructor(
    protected override readonly valueMapper: PosNetPosRequestValueMapper,
    protected override readonly valueFormatter: PosNetPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: PosNetPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  create3DFormInitializeRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    _paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (creditCard === null || creditCard === undefined) {
      throw new PosError('Card data is required for this transaction.')
    }
    const id = this.valueFormatter.formatOrderId(this.newOrderId(order))
    const amount = this.kurus(order)
    const installment = this.installment(order)

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      oosRequestData: {
        posnetid: account.getPosNetId(),
        ccno: creditCard.getNumber(),
        expDate: this.valueFormatter.formatCardExpDate(creditCard, 'expDate'),
        cvc: creditCard.getCvv(),
        amount,
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        installment,
        XID: id,
        cardHolderName: creditCard.getHolderName() ?? '',
        tranType: this.valueMapper.mapTxType(txType),
      },
    }
  }

  async create3DFormData(
    account: PosNetPosAccount,
    order: PosOrder | null,
    _paymentModel: PaymentModel,
    _txType: TxType,
    gatewayURL: string,
    _creditCard: CreditCard | null = null,
    extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    if (extraData === null || extraData === undefined) {
      throw new PosError('The 3D form needs the data returned by the bank (extraData).')
    }
    if (order === null || order === undefined) {
      throw new PosError('The order is required to build the 3D form.')
    }
    const inputs: Record<string, string> = {
      mid: account.getMerchantId(),
      posnetID: account.getPosNetId(),
      posnetData: this.text(extraData.data1, 'data1'),
      posnetData2: this.text(extraData.data2, 'data2'),
      digest: this.text(extraData.sign, 'sign'),
      merchantReturnURL: required(order, 'success_url'),
      // The bank's own script fills this field in the browser; it only has to be in the form.
      url: '',
      lang: this.getLang(order),
    }

    return { gateway: gatewayURL, method: 'POST', inputs }
  }

  create3DResolveMerchantRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const mappedOrder = this.mapOrder(order)
    const packet = {
      bankData: this.text(responseData.BankPacket, 'BankPacket'),
      merchantData: this.text(responseData.MerchantPacket, 'MerchantPacket'),
      sign: this.text(responseData.Sign, 'Sign'),
    }
    const mid = account.getMerchantId()
    const tid = account.getTerminalId()
    const mac = this.crypt.createHash(account, { mid, tid, oosResolveMerchantData: { ...packet } }, mappedOrder)

    return { mid, tid, oosResolveMerchantData: { ...packet, mac } }
  }

  create3DPaymentRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    _txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const mappedOrder = this.mapOrder(order)
    const packet = {
      bankData: this.text(responseData.BankPacket, 'BankPacket'),
      merchantData: this.text(responseData.MerchantPacket, 'MerchantPacket'),
      sign: this.text(responseData.Sign, 'Sign'),
      wpAmount: 0,
    }
    const mid = account.getMerchantId()
    const tid = account.getTerminalId()
    const mac = this.crypt.createHash(account, { mid, tid, oosTranData: { ...packet } }, mappedOrder)

    return { mid, tid, oosTranData: { ...packet, mac } }
  }

  createNonSecurePaymentRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const orderID = this.valueFormatter.formatOrderId(this.newOrderId(order))
    const amount = this.kurus(order)
    const installment = this.installment(order)

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      tranDateRequired: '1',
      [this.valueMapper.mapTxType(txType).toLowerCase()]: {
        orderID,
        installment,
        amount,
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        ccno: creditCard.getNumber(),
        expDate: this.valueFormatter.formatCardExpDate(creditCard, 'expDate'),
        cvc: creditCard.getCvv(),
      },
    }
  }

  createNonSecurePostAuthPaymentRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const hostLogKey = requiredBankReference(order, 'ref_ret_num')
    const amount = this.kurus(order)
    const installment = this.installment(order)

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      tranDateRequired: '1',
      [this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH).toLowerCase()]: {
        hostLogKey,
        amount,
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        installment,
      },
    }
  }

  createStatusRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const orderID = this.valueFormatter.formatOrderId(required(order, 'id'), TX_TYPE.STATUS, this.paymentModel(order))

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      [this.valueMapper.mapTxType(TX_TYPE.STATUS)]: { orderID },
    }
  }

  createCancelRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const transactionType = (order.transaction_type as TxType | undefined) ?? TX_TYPE.PAY_AUTH
    const data: Record<string, unknown> = {
      transaction: this.valueMapper.mapTxType(transactionType).toLowerCase(),
    }
    const authCode = optionalBankReference(order, 'auth_code')
    if (authCode !== null) {
      data.authCode = authCode
    }
    // Either identifies the transaction; the bank's own reference wins.
    this.addTransactionReference(data, order, TX_TYPE.CANCEL)

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      tranDateRequired: '1',
      [this.valueMapper.mapTxType(TX_TYPE.CANCEL)]: data,
    }
  }

  createRefundRequestData(account: PosNetPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    const data: Record<string, unknown> = {
      amount: this.kurus(order),
      currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
    }
    this.addTransactionReference(data, order, refundTxType)

    return {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
      tranDateRequired: '1',
      [this.valueMapper.mapTxType(refundTxType)]: data,
    }
  }

  createOrderHistoryRequestData(_account: PosNetPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('PosNetPos has no order history request.')
  }

  /** Sets `hostLogKey` or the padded `orderID`; one of the two must exist. */
  private addTransactionReference(data: Record<string, unknown>, order: PosOrder, txType: TxType): void {
    const reference = optionalBankReference(order, 'ref_ret_num')
    if (reference !== null) {
      data.hostLogKey = reference
      return
    }
    if (!isSet(order.id) || order.id === '') {
      throw new PosError('Order field "id" or "ref_ret_num" is required')
    }
    data.orderID = this.valueFormatter.formatOrderId(order.id, txType, this.paymentModel(order))
  }

  /** The id of a new payment follows the shared order id rule. */
  private newOrderId(order: PosOrder): string {
    return orderIdOf(order, ORDER_ID_LENGTH)
  }

  private paymentModel(order: PosOrder): PaymentModel {
    return (order.payment_model as PaymentModel | undefined) ?? MODEL.THREE_D_SECURE
  }

  /** The order values as they are signed and posted: padded id, amount in kuruş, bank currency code. */
  private mapOrder(order: PosOrder): PosNetMappedOrder {
    return {
      id: this.valueFormatter.formatOrderId(required(order, 'id')),
      amount: this.kurus(order),
      currency: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
    }
  }

  /** The order amount in kuruş; a missing, non-numeric, non-positive or sub-kuruş amount never reaches the bank. */
  private kurus(order: PosOrder): number {
    const amount = parseOrderAmount(required(order, 'amount'))
    if (!(amount > 0)) {
      throw new PosError('The order amount must be a positive number.')
    }
    const kurus = this.valueFormatter.formatAmount(amount)
    if (!Number.isSafeInteger(kurus) || kurus < 1) {
      throw new PosError('The order amount must be at least 0.01.')
    }
    return kurus
  }

  private installment(order: PosOrder): string {
    return this.valueFormatter.formatInstallment(parseInstallment(order.installment))
  }

  private text(value: unknown, name: string): string {
    if (typeof value !== 'string' || value === '') {
      throw new PosError(`"${name}" must be a non-empty string`)
    }
    return value
  }
}
