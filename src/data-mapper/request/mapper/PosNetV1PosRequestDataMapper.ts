import type { PosNetV1PosCrypt } from '../../../crypt/PosNetV1PosCrypt.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../errors.js'
import type { PosNetPosAccount } from '../../../model/account/PosNetPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet, required } from '../../../util/required.js'
import type { PosNetV1PosRequestValueFormatter } from '../value-formatter/PosNetV1PosRequestValueFormatter.js'
import type { PosNetV1PosRequestValueMapper } from '../value-mapper/PosNetV1PosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'PosNetV1Pos'

const CARD_MAC_PARAMS = 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount'
const REFERENCE_MAC_PARAMS = 'MerchantNo:TerminalNo:ReferenceCode:OrderId'
const MERCHANT_MAC_PARAMS = 'MerchantNo:TerminalNo'
const PROVISION_MAC_PARAMS = 'MerchantNo:TerminalNo:SecureTransactionId:CavvData:Eci:MdStatus'

/** Creates request data for the POSNET JSON API (Albaraka). */
export class PosNetV1PosRequestDataMapper extends AbstractRequestDataMapper<PosNetPosAccount> {
  static readonly API_VERSION = 'V100'

  constructor(
    protected override readonly valueMapper: PosNetV1PosRequestValueMapper,
    protected override readonly valueFormatter: PosNetV1PosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: PosNetV1PosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  /**
   * The provision request after a successful 3D authentication. Order id, amount, currency and installments come
   * from the order; only the 3D session values come from the callback, and each must be a plain string there.
   */
  create3DPaymentRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    _txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const id = this.valueFormatter.formatOrderId(required(order, 'id'))
    const amount = this.kurus(order)
    const installment = this.installment(order)
    const mdStatus = this.mdStatus(responseData)

    const requestData: Record<string, unknown> = {
      ApiType: 'JSON',
      ApiVersion: PosNetV1PosRequestDataMapper.API_VERSION,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      PaymentInstrumentType: 'CARD',
      IsEncrypted: 'N',
      IsTDSecureMerchant: 'Y',
      IsMailOrder: 'N',
      ThreeDSecureData: {
        SecureTransactionId: this.callbackText(responseData, 'SecureTransactionId', false),
        CavvData: this.callbackText(responseData, 'CAVV', true),
        Eci: this.callbackText(responseData, 'ECI', false),
        MdStatus: mdStatus,
        MD: this.callbackText(responseData, 'MD', false),
      },
      MACParams: PROVISION_MAC_PARAMS,
      Amount: amount,
      CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
      PointAmount: 0,
      OrderId: id,
      InstallmentCount: this.valueFormatter.formatInstallment(installment),
      InstallmentType: installment > 1 ? 'Y' : 'N',
    }
    requestData.MAC = this.crypt.createHash(account, { ...requestData })

    return requestData
  }

  createNonSecurePaymentRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    _txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const id = this.valueFormatter.formatOrderId(required(order, 'id'))
    const amount = this.kurus(order)
    const installment = this.installment(order)

    const requestData: Record<string, unknown> = {
      ApiType: 'JSON',
      ApiVersion: PosNetV1PosRequestDataMapper.API_VERSION,
      MACParams: CARD_MAC_PARAMS,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
      AdditionalInfoData: null,
      CardInformationData: {
        CardNo: creditCard.getNumber(),
        ExpireDate: this.valueFormatter.formatCardExpDate(creditCard, 'ExpireDate'),
        Cvc2: creditCard.getCvv(),
        CardHolderName: creditCard.getHolderName(),
      },
      IsMailOrder: 'N',
      IsRecurring: null,
      IsTDSecureMerchant: null,
      PaymentInstrumentType: 'CARD',
      ThreeDSecureData: null,
      Amount: amount,
      CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
      OrderId: id,
      InstallmentCount: this.valueFormatter.formatInstallment(installment),
      InstallmentType: installment > 1 ? 'Y' : 'N',
      KOICode: null,
      MerchantMessageData: null,
      PointAmount: null,
    }
    requestData.MAC = this.crypt.hashFromParams(account, { ...requestData }, CARD_MAC_PARAMS, ':')

    return requestData
  }

  createNonSecurePostAuthPaymentRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const referenceCode = required(order, 'ref_ret_num')
    const amount = this.kurus(order)
    const installment = this.installment(order)

    const requestData: Record<string, unknown> = {
      ApiType: 'JSON',
      ApiVersion: PosNetV1PosRequestDataMapper.API_VERSION,
      MACParams: MERCHANT_MAC_PARAMS,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
      Amount: amount,
      CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
      ReferenceCode: referenceCode,
      InstallmentCount: this.valueFormatter.formatInstallment(installment),
      InstallmentType: installment > 1 ? 'Y' : 'N',
    }
    requestData.MAC = this.crypt.hashFromParams(account, { ...requestData }, MERCHANT_MAC_PARAMS, ':')

    return requestData
  }

  createStatusRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.valueFormatter.formatOrderId(required(order, 'id'), TX_TYPE.STATUS, this.paymentModel(order))

    const requestData: Record<string, unknown> = {
      ApiType: 'JSON',
      ApiVersion: PosNetV1PosRequestDataMapper.API_VERSION,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      MACParams: MERCHANT_MAC_PARAMS,
      CipheredData: null,
      DealerData: null,
      IsEncrypted: 'N',
      PaymentFacilitatorData: null,
      OrderId: orderId,
    }
    requestData.MAC = this.crypt.hashFromParams(account, { ...requestData }, MERCHANT_MAC_PARAMS, ':')

    return requestData
  }

  createCancelRequestData(account: PosNetPosAccount, order: PosOrder): Record<string, unknown> {
    const requestData = this.referenceRequest(account, order, TX_TYPE.CANCEL)
    requestData.MAC = this.crypt.hashFromParams(account, { ...requestData }, REFERENCE_MAC_PARAMS, ':')

    return requestData
  }

  createRefundRequestData(account: PosNetPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    // The amount is only sent for orders paid without 3D, but it must be valid either way.
    const amount = this.kurus(order)
    const carriesAmount = this.paymentModel(order) === MODEL.NON_SECURE
    if (!carriesAmount && refundTxType === TX_TYPE.REFUND_PARTIAL) {
      // The bank's reference lookup of a 3D order has no amount field, so the request would refund the whole
      // payment or be refused: fail before anything is sent.
      throw new UnsupportedTransactionTypeError(
        "Partial refunds are only supported for non-3D (regular) orders; refund the full amount or pass payment_model 'regular' for a regular order.",
      )
    }
    const requestData = this.referenceRequest(account, order, refundTxType)

    if (carriesAmount) {
      requestData.Amount = amount
      requestData.CurrencyCode = this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)
    }
    requestData.MAC = this.crypt.hashFromParams(account, { ...requestData }, REFERENCE_MAC_PARAMS, ':')

    return requestData
  }

  createOrderHistoryRequestData(_account: PosNetPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('PosNetV1Pos has no order history request.')
  }

  async create3DFormData(
    account: PosNetPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
    _extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    if (order === null || order === undefined) {
      throw new PosError('The order is required to build the 3D form.')
    }
    const id = this.valueFormatter.formatOrderId(required(order, 'id'))
    const amount = this.kurus(order)
    const installment = this.installment(order)

    let inputs: Record<string, string> = {
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      PosnetID: account.getPosNetId(),
      TransactionType: this.valueMapper.mapTxType(txType),
      OrderId: id,
      Amount: String(amount),
      CurrencyCode: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      MerchantReturnURL: required(order, 'success_url'),
      InstallmentCount: this.valueFormatter.formatInstallment(installment),
      Language: this.getLang(order),
      TxnState: 'INITIAL',
      OpenNewWindow: '0',
    }

    if (creditCard !== null && creditCard !== undefined) {
      inputs = {
        ...inputs,
        CardNo: creditCard.getNumber(),
        // The bank's form field is spelled differently from the name in the signed field list.
        ExpiredDate: this.valueFormatter.formatCardExpDate(creditCard, 'ExpiredDate'),
        Cvv: creditCard.getCvv(),
        CardHolderName: creditCard.getHolderName() ?? '',
        MacParams: CARD_MAC_PARAMS,
        UseOOS: '0',
      }
    } else {
      // The card number is typed on the bank's own page.
      inputs = { ...inputs, UseOOS: '1', MacParams: 'MerchantNo:TerminalNo:Amount' }
    }

    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )
    const mac = this.crypt.create3DHash(account, inputs)

    return { gateway: gatewayURL, method: 'POST', inputs: { ...inputs, Mac: mac } }
  }

  /** Cancel and refund share the lookup by the bank's reference code, or else by the padded order id. */
  private referenceRequest(account: PosNetPosAccount, order: PosOrder, lookupTxType: TxType): Record<string, unknown> {
    const hasReference = isSet(order.ref_ret_num) && order.ref_ret_num !== ''
    if (!hasReference && (!isSet(order.id) || order.id === '')) {
      throw new PosError('Order field "id" or "ref_ret_num" is required')
    }
    const transactionType = (order.transaction_type as TxType | undefined) ?? TX_TYPE.PAY_AUTH

    return {
      ApiType: 'JSON',
      ApiVersion: PosNetV1PosRequestDataMapper.API_VERSION,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
      MACParams: REFERENCE_MAC_PARAMS,
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
      ReferenceCode: hasReference ? order.ref_ret_num : null,
      OrderId: hasReference
        ? null
        : this.valueFormatter.formatOrderId(order.id as string, lookupTxType, this.paymentModel(order)),
      TransactionType: this.valueMapper.mapTxType(transactionType),
    }
  }

  private paymentModel(order: PosOrder): PaymentModel {
    return (order.payment_model as PaymentModel | undefined) ?? MODEL.THREE_D_SECURE
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

  private installment(order: PosOrder): number {
    return parseInstallment(order.installment)
  }

  /** A signed 3D session value from the callback: an own string (or, where allowed, `null` meaning empty). */
  private callbackText(callback: Record<string, unknown>, name: string, nullable: boolean): string {
    const value: unknown = ownValue(callback, name)
    if (typeof value === 'string') return value
    if (nullable && value === null) return ''
    throw new PosError(`The 3D callback value "${name}" is missing or not text.`)
  }

  private mdStatus(callback: Record<string, unknown>): number {
    const text = this.callbackText(callback, 'MdStatus', false)
    if (!/^\d{1,2}$/.test(text)) {
      throw new PosError('The 3D callback value "MdStatus" is not a number.')
    }
    return Number(text)
  }
}
