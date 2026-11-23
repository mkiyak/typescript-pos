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

/** S: Auth/PreAuth/PostAuth, C: Refund (order history and status `CHARGE_TYPE_CD`). */
const HISTORY_RESPONSE_TX_TYPE_MAPPINGS: Readonly<Record<string, TxType>> = {
  S: TX_TYPE.PAY_AUTH,
  C: TX_TYPE.REFUND,
}

export class AssecoPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '3d': MODEL.THREE_D_SECURE,
    '3d_pay': MODEL.THREE_D_PAY,
    '3d_pay_hosting': MODEL.THREE_D_PAY_HOSTING,
    '3d_host': MODEL.THREE_D_HOST,
    regular: MODEL.NON_SECURE,
  }

  /**
   * D: failed, A: authorization before end of day, C: pre-auth closed before end of day, PN: pending,
   * CNCL: canceled, ERR: errored, S: sale, R: technical cancel needed, V: void.
   */
  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    D: PAYMENT_STATUS.ERROR,
    ERR: PAYMENT_STATUS.ERROR,
    A: PAYMENT_STATUS.PAYMENT_COMPLETED,
    C: PAYMENT_STATUS.PAYMENT_COMPLETED,
    S: PAYMENT_STATUS.PAYMENT_COMPLETED,
    PN: PAYMENT_STATUS.PAYMENT_PENDING,
    CNCL: PAYMENT_STATUS.CANCELED,
    V: PAYMENT_STATUS.CANCELED,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  override mapTxType(txType: string | number, _paymentModel: PaymentModel | null = null): TxType | null {
    return ownValue(HISTORY_RESPONSE_TX_TYPE_MAPPINGS, String(txType)) ?? null
  }
}
