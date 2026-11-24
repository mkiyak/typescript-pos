import {
  HashMismatchError,
  OrderMismatchError,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import {
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

type Raw = Record<string, unknown>

/** Largest difference between the callback amount and the order amount still treated as equal. */
const AMOUNT_TOLERANCE = 0.005

/**
 * Callback `PurchAmount`: digits with two implied decimals, optionally written with a dot before the last two
 * (`100.00` or `10000` for 100.00; `101` for 1.01).
 */
const CALLBACK_AMOUNT = /^\d+(\.\d{2})?$/

/** A plain decimal order amount (no hex, exponent or Infinity, which `Number()` would accept). */

/** A nested record of a decoded bank response, or an empty one. */
function record(data: unknown, key: string): Raw {
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, key)) {
    const value = (data as Raw)[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Raw
    }
  }

  return {}
}

/**
 * The callback `PurchAmount` as a number, read from the digits the DOC-STD §15 hash signs (the value without its
 * dot) with two implied decimals. `1.00`, `100` and `10.0` share one valid hash, so only the two-decimal and the
 * dotless forms are accepted; `10.0`, `1.5` or `1.000` are NaN instead of being read as another amount.
 */
function parseCallbackAmount(value: unknown): number {
  if (typeof value !== 'string' || !CALLBACK_AMOUNT.test(value)) return Number.NaN

  return Number(value.replace('.', '')) / 100
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function text(data: Raw, key: string): string {
  const value = Object.hasOwn(data, key) ? data[key] : undefined
  return value === undefined || value === null ? '' : String(value)
}

/**
 * PayFlex MPI ISD v4 (Innova), used by VakifBank VPOS 7/24 and Ziraat.
 *
 * VakifBank 2026 Standard API:
 * - `make3DPayment` provisions only a fully authenticated callback: `Status` `Y`, `Eci` `02`/`05`, a non-empty
 *   `Cavv` and `MdStatus` absent or `1`. Anything else (half secure, attempts, errors) is mapped as declined
 *   without an HTTP call. The rule is checked first, so a malformed `Eci` never reaches the hash check.
 * - The callback `Hash`, when present, must verify (`HashMismatchError` otherwise) before provisioning; with
 *   `require_3d_hash` a callback without `Hash` is rejected too.
 * - The callback must belong to this payment: `PurchAmount` equals the order amount (within 0.005),
 *   `PurchCurrency` the order currency code and `MerchantId` this account (`OrderMismatchError` otherwise).
 * - Enrollment continues only for `Status` `Y`; every other status is a `PosError`.
 */
export class PayFlexV4Pos extends AbstractGateway<PayFlexPosAccount> {
  static readonly NAME = 'PayFlexV4'

  static override readonly GATEWAY_CLASS: string = 'PayFlexV4Pos'

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  /**
   * Unlike other gateways PayFlex needs the card again for the provision request.
   *
   * @throws HashMismatchError when 3D authentication succeeded but the callback `Hash` does not verify
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE

    // Strict rule first: a malformed ECI never reaches the hash; a declined callback is mapped without the hash
    // check and a successful one must pass it, so both paths fail closed.
    if (!this.is3dAuthSuccess(gatewayResponseData)) {
      return this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
    }

    if (this.config.require_3d_hash === true && !Object.keys(gatewayResponseData).some(isHashKey)) {
      throw new HashMismatchError('3D callback has no Hash')
    }

    if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    this.assertCallbackMatchesOrder(gatewayResponseData, order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, gatewayResponseData, card),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = this.responseDataMapper.map3DPaymentData(gatewayResponseData, bankResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PayFlex V4 does not support the 3D Pay model')
  }

  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PayFlex V4 does not support the 3D Host model')
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('PayFlex V4 does not support order history')
  }

  /**
   * Sends the enrollment request (is the card enrolled in 3-D Secure?) and returns the ACS redirect form.
   * The card is always required, `createWithoutCard` is ignored.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the enrollment status is not `Y`
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    _createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData> {
    this.check3DFormInputs(paymentModel, txType, card)

    if (formFormat === FORM_FORMAT.HTML) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    const data = await this.sendEnrollmentRequest(order, card as CreditCard, txType, paymentModel)
    const veRes = record(record(data, 'Message'), 'VERes')
    const status = text(veRes, 'Status')

    // Y: enrolled, N: not enrolled, U: cannot be processed, E: error
    if (status !== 'Y') {
      this.logger.error('enrollment fail response', data)
      if (status === 'E') {
        throw new PosError(text(data, 'ErrorMessage') || 'Enrollment failed', {
          cause: { code: text(data, 'MessageErrorCode') },
        })
      }
      if (status === 'N') {
        throw new PosError('Card is not enrolled in 3-D Secure')
      }
      if (status === 'U') {
        throw new PosError('Card enrollment could not be checked')
      }
      throw new PosError(`Unexpected 3-D Secure enrollment status: ${status}`)
    }

    this.logger.debug('preparing 3D form data')

    return (await this.requestDataMapper.create3DFormData(
      this.account,
      null,
      paymentModel,
      txType,
      '',
      null,
      veRes,
    )) as ThreeDFormData
  }

  /** Passes the callback to the response mapper so it can apply the strict 3D rule. */
  protected override is3dAuthSuccess(responseData: Raw): boolean {
    const mdStatus = this.responseDataMapper.extractMdStatus(responseData)

    if (this.responseDataMapper.is3dAuthSuccess(mdStatus, responseData)) {
      this.logger.info('3d auth success', { md_status: mdStatus })

      return true
    }

    this.logger.error('3d auth fail', { md_status: mdStatus, eci: responseData.Eci ?? null })

    return false
  }

  /**
   * Binds a verified callback to this payment (fail closed: missing values never match). `MerchantId` must be
   * the account merchant id; for sub-dealer accounts the bank may send the sub-dealer number instead (VakifBank
   * 2026 guide §15), so that is accepted too.
   *
   * Without a signed callback (`require_3d_hash` false and no `Hash`) these values come from the browser and the
   * guard only stops naive replays.
   */
  private assertCallbackMatchesOrder(callback: GatewayResponseData, order: PosOrder): void {
    const own = (key: string): unknown => (Object.hasOwn(callback, key) ? callback[key] : undefined)

    const callbackAmount = parseCallbackAmount(own('PurchAmount'))
    const orderAmount = parseOrderAmount(order.amount)
    // NaN (missing or malformed on either side) never matches
    if (!(Math.abs(callbackAmount - orderAmount) < AMOUNT_TOLERANCE)) {
      this.fail('amount', asText(order.amount), asText(own('PurchAmount')))
    }

    const expectedCurrency = String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
    if (own('PurchCurrency') !== expectedCurrency) {
      this.fail('currency', expectedCurrency, asText(own('PurchCurrency')))
    }

    const merchantIds = [this.account.getMerchantId()]
    const subMerchantId = this.account.getSubMerchantId()
    if (this.account.isSubBranch() && subMerchantId !== null && subMerchantId !== '') {
      merchantIds.push(subMerchantId)
    }
    const merchantId = own('MerchantId')
    if (typeof merchantId !== 'string' || !merchantIds.includes(merchantId)) {
      this.fail('merchant_id', merchantIds.join(' | '), asText(merchantId))
    }
  }

  private fail(field: 'amount' | 'currency' | 'merchant_id', expected: string, actual: string): never {
    this.logger.error(`3D callback ${field} does not match the payment`, { expected, actual })
    throw new OrderMismatchError(field, expected, actual)
  }

  /** Enrollment status query (VerifyEnrollmentRequest) sent to `gateway_3d`. */
  private async sendEnrollmentRequest(
    order: PosOrder,
    card: CreditCard,
    orderTxType: TxType,
    paymentModel: PaymentModel,
  ): Promise<Raw> {
    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(
        this.account,
        order,
        paymentModel,
        orderTxType,
        card,
      ),
      requestTxType,
      order,
      paymentModel,
    )

    return this.sendRequest(requestTxType, paymentModel, requestData, order)
  }
}

function isHashKey(key: string): boolean {
  return key.toLowerCase() === 'hash'
}
