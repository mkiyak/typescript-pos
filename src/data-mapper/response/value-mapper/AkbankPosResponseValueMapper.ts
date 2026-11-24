import {
  CURRENCY,
  type Currency,
  MODEL,
  PAYMENT_STATUS,
  type PaymentModel,
  type PaymentStatus,
  TX_TYPE,
  type TxType,
} from '../../../PosInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

export class AkbankPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  /** Same codes as the request table, except the history query: a query type is not a transaction type. */
  protected override txTypeMappings: Partial<Record<TxType, string | Partial<Record<PaymentModel, string>>>> = {
    [TX_TYPE.PAY_AUTH]: {
      [MODEL.NON_SECURE]: '1000',
      [MODEL.THREE_D_SECURE]: '3000',
      [MODEL.THREE_D_PAY]: '3000',
      [MODEL.THREE_D_HOST]: '3000',
    },
    [TX_TYPE.PAY_PRE_AUTH]: {
      [MODEL.NON_SECURE]: '1004',
      [MODEL.THREE_D_SECURE]: '3004',
      [MODEL.THREE_D_PAY]: '3004',
      [MODEL.THREE_D_HOST]: '3004',
    },
    [TX_TYPE.PAY_POST_AUTH]: '1005',
    [TX_TYPE.REFUND]: '1002',
    [TX_TYPE.REFUND_PARTIAL]: '1002',
    [TX_TYPE.CANCEL]: '1003',
    [TX_TYPE.ORDER_HISTORY]: '1010',
  }

  /**
   * N: normal, S: suspicious, V: voided, R: reversal. The last three are the words the order history
   * answer uses.
   */
  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    N: PAYMENT_STATUS.PAYMENT_COMPLETED,
    S: PAYMENT_STATUS.ERROR,
    V: PAYMENT_STATUS.CANCELED,
    R: PAYMENT_STATUS.FULLY_REFUNDED,
    Başarılı: PAYMENT_STATUS.PAYMENT_COMPLETED,
    Başarısız: PAYMENT_STATUS.ERROR,
    İptal: PAYMENT_STATUS.CANCELED,
  }

  private readonly recurringOrderStatusMappings: Record<string, PaymentStatus> = {
    S: PAYMENT_STATUS.PAYMENT_COMPLETED,
    W: PAYMENT_STATUS.PAYMENT_PENDING,
    // a fulfilled payment that was canceled
    V: PAYMENT_STATUS.CANCELED,
    // a payment that was canceled before it was fulfilled
    C: PAYMENT_STATUS.CANCELED,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  /**
   * Order status with the pre-auth state and the recurring plan taken into account.
   * Pre-auth status `O` (open) turns a completed payment into an open pre-authorization.
   */
  mapOrderStatusDetailed(
    orderStatus: string,
    preAuthStatus: string | null,
    isRecurringOrder: boolean,
  ): PaymentStatus | string {
    if (isRecurringOrder) {
      return ownValue(this.recurringOrderStatusMappings, orderStatus) ?? orderStatus
    }

    const mapped = ownValue(this.orderStatusMappings, orderStatus) ?? orderStatus
    if (mapped === PAYMENT_STATUS.PAYMENT_COMPLETED && preAuthStatus === 'O') {
      return PAYMENT_STATUS.PRE_AUTH_COMPLETED
    }

    return mapped
  }
}
