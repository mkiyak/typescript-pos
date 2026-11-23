import { PosError } from '../../../errors.js'
import type { AssecoPosAccount } from '../../../model/account/AssecoPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'AssecoPos'

/** PHP isset(): neither undefined nor null. */
function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

/**
 * Creates request data for Asseco/Payten (NestPay/EST) gateways that use the ver3 hash algorithm.
 */
export class AssecoPosRequestDataMapper extends AbstractRequestDataMapper<AssecoPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  create3DPaymentRequestData(
    account: AssecoPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const o = this.applyPaymentDefaults(order)

    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      Type: this.valueMapper.mapTxType(txType),
      IPAddress: String(o.ip),
      OrderId: String(o.id),
      Total: this.valueFormatter.formatAmount(o.amount as number),
      Currency: this.valueMapper.mapCurrency(o.currency),
      Taksit: this.valueFormatter.formatInstallment(o.installment),
      Number: responseData.md,
      PayerTxnId: responseData.xid,
      PayerSecurityLevel: responseData.eci,
      PayerAuthenticationCode: responseData.cavv,
      Mode: 'P',
    }

    if (isSet(order.recurring)) {
      Object.assign(requestData, this.createRecurringData(order.recurring as Record<string, unknown>))
    }

    return requestData
  }

  createNonSecurePaymentRequestData(
    account: AssecoPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const o = this.applyPaymentDefaults(order)

    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      Type: this.valueMapper.mapTxType(txType),
      IPAddress: String(o.ip),
      OrderId: String(o.id),
      Total: String(this.valueFormatter.formatAmount(o.amount as number)),
      Currency: String(this.valueMapper.mapCurrency(o.currency)),
      Taksit: String(this.valueFormatter.formatInstallment(o.installment)),
      Number: creditCard.getNumber(),
      Expires: this.valueFormatter.formatCardExpDate(creditCard, 'Expires'),
      Cvv2Val: creditCard.getCvv(),
      Mode: 'P',
    }

    if (isSet(order.recurring)) {
      Object.assign(requestData, this.createRecurringData(order.recurring as Record<string, unknown>))
    }

    return requestData
  }

  createNonSecurePostAuthPaymentRequestData(account: AssecoPosAccount, order: PosOrder): Record<string, unknown> {
    const amount = order.amount
    const preAuthAmount = order.pre_auth_amount

    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      Type: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
      OrderId: String(order.id),
      Total: isSet(amount) ? String(this.valueFormatter.formatAmount(amount)) : null,
    }

    if (isSet(amount) && isSet(preAuthAmount) && preAuthAmount < amount) {
      // when amount > pre_auth_amount the bank needs the PREAMT value
      requestData.Extra = { PREAMT: String(this.valueFormatter.formatAmount(preAuthAmount)) }
    }

    return requestData
  }

  createStatusRequestData(account: AssecoPosAccount, order: PosOrder): Record<string, unknown> {
    const extra: Record<string, unknown> = { [this.valueMapper.mapTxType(TX_TYPE.STATUS)]: 'QUERY' }
    const requestData: Record<string, unknown> = { ...this.getRequestAccountData(account), Extra: extra }

    if (isSet(order.id)) {
      requestData.OrderId = order.id
    } else if (isSet(order.recurringId)) {
      extra.RECURRINGID = order.recurringId
    }

    return requestData
  }

  createCancelRequestData(account: AssecoPosAccount, order: PosOrder): Record<string, unknown> {
    if (isSet(order.recurringOrderInstallmentNumber)) {
      // cancels only pending recurring order installments; fulfilled transactions are not cancelled.
      // Installment order ids look like '202210121ABC', '202210121ABC-2', '202210121ABC-3', ...
      return {
        ...this.getRequestAccountData(account),
        Extra: {
          RECORDTYPE: 'Order',
          RECURRINGOPERATION: 'Cancel',
          RECORDID: `${order.id}-${order.recurringOrderInstallmentNumber}`,
        },
      }
    }

    return {
      ...this.getRequestAccountData(account),
      OrderId: order.id,
      Type: this.valueMapper.mapTxType(TX_TYPE.CANCEL),
    }
  }

  createRefundRequestData(account: AssecoPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      OrderId: String(order.id),
      Currency: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      Type: this.valueMapper.mapTxType(refundTxType),
    }

    if (isSet(order.amount)) {
      requestData.Total = String(this.valueFormatter.formatAmount(order.amount))
    }

    return requestData
  }

  createOrderHistoryRequestData(account: AssecoPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      ...this.getRequestAccountData(account),
      OrderId: String(order.id),
      Extra: { [this.valueMapper.mapTxType(TX_TYPE.ORDER_HISTORY)]: 'QUERY' },
    }
  }

  async create3DFormData(
    account: AssecoPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
    _extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    if (order === null) {
      throw new PosError('Order data is required to create the 3D form data')
    }
    const o = this.applyPaymentDefaults(order)

    let inputs: Record<string, string> = {
      hashAlgorithm: 'ver3',
      clientid: account.getMerchantId(),
      storetype: this.valueMapper.mapSecureType(paymentModel),
      amount: String(this.valueFormatter.formatAmount(Number(o.amount))),
      oid: String(o.id),
      okUrl: String(o.success_url),
      failUrl: String(o.fail_url),
      rnd: this.crypt.generateRandomString(),
      lang: this.getLang(o),
      currency: String(this.valueMapper.mapCurrency(o.currency)),
      taksit: String(this.valueFormatter.formatInstallment(o.installment)),
      TranType: this.valueMapper.mapTxType(txType),
    }

    if (creditCard !== null) {
      inputs.pan = creditCard.getNumber()
      inputs.Ecom_Payment_Card_ExpDate_Month = this.valueFormatter.formatCardExpDate(
        creditCard,
        'Ecom_Payment_Card_ExpDate_Month',
      )
      inputs.Ecom_Payment_Card_ExpDate_Year = this.valueFormatter.formatCardExpDate(
        creditCard,
        'Ecom_Payment_Card_ExpDate_Year',
      )
      inputs.cv2 = creditCard.getCvv()
    }

    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )

    inputs.hash = this.crypt.create3DHash(account, inputs)

    return { gateway: gatewayURL, method: 'POST', inputs }
  }

  private applyPaymentDefaults(
    order: PosOrder,
  ): PosOrder & { installment: number; currency: NonNullable<PosOrder['currency']> } {
    return {
      ...order,
      installment: order.installment ?? 0,
      currency: order.currency ?? CURRENCY.TRY,
      ip: order.ip ?? '',
    }
  }

  private getRequestAccountData(account: AssecoPosAccount): { Name: string; Password: string; ClientId: string } {
    return {
      Name: account.getUsername(),
      Password: account.getPassword(),
      ClientId: account.getMerchantId(),
    }
  }

  private createRecurringData(recurring: Record<string, unknown>): { PbOrder: Record<string, string> } {
    return {
      PbOrder: {
        OrderType: '0', // 0: default, no installments
        OrderFrequencyInterval: String(recurring.frequency),
        // D|W|M|Y
        OrderFrequencyCycle: this.valueMapper.mapRecurringFrequency(String(recurring.frequencyType)),
        TotalNumberPayments: String(recurring.installment),
      },
    }
  }
}
