import type { CryptInterface } from '../../../crypt/CryptInterface.js'
import { NotImplementedError } from '../../../errors.js'
import { runHooks } from '../../../hooks.js'
import type { AbstractPosAccount } from '../../../model/account/AbstractPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { LANG, type Lang, type PaymentModel, type TxType } from '../../../PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import type { RequestValueFormatterInterface } from '../value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../value-mapper/RequestValueMapperInterface.js'
import type { RequestDataMapperInterface } from './RequestDataMapperInterface.js'

/** Base request data mapper; hooks can change the mapped data. */
export abstract class AbstractRequestDataMapper<A extends AbstractPosAccount = AbstractPosAccount>
  implements RequestDataMapperInterface<A>
{
  protected testMode = false

  constructor(
    protected readonly valueMapper: RequestValueMapperInterface,
    protected readonly valueFormatter: RequestValueFormatterInterface,
    protected readonly hooks: PosHooks,
    protected readonly crypt: CryptInterface<A>,
    protected readonly defaultLang: Lang = LANG.TR,
  ) {}

  isTestMode(): boolean {
    return this.testMode
  }

  setTestMode(testMode: boolean): void {
    this.testMode = testMode
  }

  abstract create3DFormData(
    account: A,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard?: CreditCard | null,
    extraData?: Record<string, unknown> | null,
  ): Promise<ThreeDFormData | string>

  abstract create3DPaymentRequestData(
    account: A,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
    creditCard?: CreditCard | null,
  ): Record<string, unknown>

  abstract createNonSecurePaymentRequestData(
    account: A,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown>

  abstract createNonSecurePostAuthPaymentRequestData(account: A, order: PosOrder): Record<string, unknown>

  abstract createStatusRequestData(account: A, order: PosOrder): Record<string, unknown>

  abstract createCancelRequestData(account: A, order: PosOrder): Record<string, unknown>

  abstract createRefundRequestData(account: A, order: PosOrder, refundTxType: TxType): Record<string, unknown>

  abstract createOrderHistoryRequestData(account: A, order: PosOrder): Record<string, unknown>

  create3DFormInitializeRequestData(
    _account: A,
    _order: PosOrder,
    _paymentModel: PaymentModel,
    _txType: TxType,
    _creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    throw new NotImplementedError('Not supported')
  }

  /**
   * Language for the bank UI and error messages. Falls back to the default language;
   * if no mapping exists the value mapper returns the TR mapping or the value as is.
   */
  protected getLang(order: PosOrder): string {
    return this.valueMapper.mapLang(order.lang ?? this.defaultLang)
  }

  /**
   * Runs `onBefore3DFormHashCalculated` hooks on a copy of the inputs
   * and returns the inputs to hash. Call it right before computing the 3D form hash.
   */
  protected async dispatchBefore3DFormHashCalculated(
    formInputs: Record<string, string>,
    bankName: string,
    txType: TxType,
    paymentModel: PaymentModel,
    gatewayClass: string,
  ): Promise<Record<string, string>> {
    const event: Before3DFormHashCalculatedEvent = {
      formInputs: { ...formInputs },
      bankName,
      txType,
      paymentModel,
      gatewayClass,
    }
    await runHooks(this.hooks.onBefore3DFormHashCalculated, event)
    return event.formInputs
  }
}
