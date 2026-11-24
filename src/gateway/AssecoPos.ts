import { HashMismatchError, OrderMismatchError, UnsupportedFormFormatError } from '../errors.js'
import type { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import { FORM_FORMAT, type FormFormat, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** Largest difference between the callback amount and the order amount still treated as equal. */
const AMOUNT_TOLERANCE = 0.005

/** A plain decimal number (no hex, exponent, Infinity or empty string, which `Number()` would accept). */

/** Callback `storetype` values (compared case-insensitively) accepted by each payment method. */
const STORE_TYPES_3D = ['3d'] as const
const STORE_TYPES_3D_PAY = ['3d_pay', '3d_pay_hosting'] as const
const STORE_TYPES_3D_HOST = ['3d_host'] as const

/**
 * Asseco/Payten (NestPay/EST) gateway, previously EstV3Pos.
 *
 * After the hash check, 3D Pay / 3D Pay Hosting / 3D Host callbacks must belong to the order
 * they are completed for: the mapped `order_id` must equal `order.id` and the callback `amount` must equal
 * `order.amount` (within 0.005), otherwise `OrderMismatchError`.
 *
 * Addition: the hash-covered callback `storetype` must match the payment method it is completed with
 * (`3d_pay`/`3d_pay_hosting` for 3D Pay and 3D Pay Hosting, `3d_host` for 3D Host, `3d` for 3D Secure when present),
 * otherwise `OrderMismatchError` with `field: 'storetype'`. Without it a 3D Pay Hosting callback declined by the
 * bank (ProcReturnCode 99) would be mapped as approved by the 3D Host mapper, which only looks at mdStatus.
 */
export class AssecoPos extends AbstractGateway<AssecoPosAccount> {
  static readonly NAME = 'Asseco'

  static override readonly GATEWAY_CLASS: string = 'AssecoPos'

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [
      MODEL.THREE_D_SECURE,
      MODEL.THREE_D_PAY,
      MODEL.THREE_D_HOST,
      MODEL.THREE_D_PAY_HOSTING,
      MODEL.NON_SECURE,
    ],
    [TX_TYPE.PAY_PRE_AUTH]: true,
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /**
   * @throws HashMismatchError when 3D authentication succeeded but the callback hash does not verify
   * @throws OrderMismatchError (field `storetype`) when the callback carries a storetype other than `3d`
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE

    if (!this.is3dAuthSuccess(gatewayResponseData)) {
      return this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
    }

    this.assertValid3DHash(gatewayResponseData)
    this.assertStoreType(gatewayResponseData, STORE_TYPES_3D, true, txType, order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, gatewayResponseData),
      txType,
      order,
      paymentModel,
    )
    const provisionResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = this.responseDataMapper.map3DPaymentData(gatewayResponseData, provisionResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  /**
   * @throws HashMismatchError when the callback hash does not verify
   * @throws OrderMismatchError when the callback belongs to another order id, amount or payment model (storetype)
   */
  async make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    this.assertValid3DHash(gatewayResponseData)
    this.assertStoreType(gatewayResponseData, STORE_TYPES_3D_PAY, false, txType, order)

    const response = this.responseDataMapper.map3DPayResponseData(gatewayResponseData, txType, order)
    this.assertCallbackMatchesOrder(gatewayResponseData, response, order)

    return response
  }

  /**
   * @throws HashMismatchError when the callback hash does not verify
   * @throws OrderMismatchError when the callback belongs to another order id, amount or payment model (storetype)
   */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    this.assertValid3DHash(gatewayResponseData)
    this.assertStoreType(gatewayResponseData, STORE_TYPES_3D_HOST, false, txType, order)

    const response = this.responseDataMapper.map3DHostResponseData(gatewayResponseData, txType, order)
    this.assertCallbackMatchesOrder(gatewayResponseData, response, order)

    return response
  }

  /**
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData> {
    this.check3DFormInputs(paymentModel, txType, card, createWithoutCard)

    if (formFormat === FORM_FORMAT.HTML) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    this.logger.debug('preparing 3D form data')

    return (await this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      card,
    )) as ThreeDFormData
  }

  private assertValid3DHash(gatewayResponseData: GatewayResponseData): void {
    if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }
  }

  /**
   * A verified callback must have been produced for the payment model it is completed with. On a mismatch the
   * callback is mapped with the mapper of its actual storetype, so `OrderMismatchError.paymentMayHaveCompleted`
   * reflects what the bank reported.
   */
  private assertStoreType(
    callback: GatewayResponseData,
    allowed: readonly string[],
    optional: boolean,
    txType: TxType,
    order: PosOrder,
  ): void {
    const raw = ownValue(callback, 'storetype')
    if (optional && (raw === undefined || raw === null || raw === '')) {
      return
    }
    const actual = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (allowed.includes(actual)) {
      return
    }

    const response =
      actual === '3d_host'
        ? this.responseDataMapper.map3DHostResponseData(callback, txType, order)
        : this.responseDataMapper.map3DPayResponseData(callback, txType, order)
    const expected = allowed.join(' | ')
    this.logger.error('3D callback storetype does not match the payment model', { expected, actual: asText(raw) })
    throw new OrderMismatchError('storetype', expected, asText(raw), response)
  }

  /** A verified callback must still belong to this order (id and amount). */
  private assertCallbackMatchesOrder(callback: GatewayResponseData, response: PosResponse, order: PosOrder): void {
    const expectedId = asText(order.id)
    const actualId = asText(response.order_id)
    if (expectedId === '' || actualId !== expectedId) {
      this.logger.error('3D callback order id does not match the order', { expected: expectedId, actual: actualId })
      throw new OrderMismatchError('order_id', expectedId, actualId, response)
    }

    const callbackAmount = parseOrderAmount(callback.amount)
    const orderAmount = parseOrderAmount(order.amount)
    // NaN (missing or non-numeric on either side) never matches
    if (!(Math.abs(callbackAmount - orderAmount) < AMOUNT_TOLERANCE)) {
      const expectedAmount = asText(order.amount)
      const actualAmount = asText(callback.amount)
      this.logger.error('3D callback amount does not match the order', {
        order_id: expectedId,
        expected: expectedAmount,
        actual: actualAmount,
      })
      throw new OrderMismatchError('amount', expectedAmount, actualAmount, response)
    }
  }
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}
