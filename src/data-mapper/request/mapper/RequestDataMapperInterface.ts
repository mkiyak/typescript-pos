import type { AbstractPosAccount } from '../../../model/account/AbstractPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { PaymentModel, TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'

export interface RequestDataMapperInterface<A extends AbstractPosAccount = AbstractPosAccount> {
  isTestMode(): boolean

  setTestMode(testMode: boolean): void

  /**
   * Builds the 3D form. Async because `onBefore3DFormHashCalculated` hooks run before the hash is computed.
   *
   * @param extraData additional data for building the form, usually a bank API response (e.g. enrollment result)
   * @returns form data, or an HTML string for gateways that render the form themselves
   */
  create3DFormData(
    account: A,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard?: CreditCard | null,
    extraData?: Record<string, unknown> | null,
  ): Promise<ThreeDFormData | string>

  /**
   * @param responseData the bank's 3D callback data
   * @param creditCard   only used by gateways that need card data again at this step (PayFlex)
   */
  create3DPaymentRequestData(
    account: A,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
    creditCard?: CreditCard | null,
  ): Record<string, unknown>

  createNonSecurePaymentRequestData(
    account: A,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown>

  createNonSecurePostAuthPaymentRequestData(account: A, order: PosOrder): Record<string, unknown>

  createStatusRequestData(account: A, order: PosOrder): Record<string, unknown>

  createCancelRequestData(account: A, order: PosOrder): Record<string, unknown>

  createRefundRequestData(account: A, order: PosOrder, refundTxType: TxType): Record<string, unknown>

  createOrderHistoryRequestData(account: A, order: PosOrder): Record<string, unknown>

  /**
   * Request sent to the bank before the 3D form (enrollment check, session init, hosted form preparation).
   * Gateways without such a step throw NotImplementedError.
   */
  create3DFormInitializeRequestData(
    account: A,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard?: CreditCard | null,
  ): Record<string, unknown>
}
