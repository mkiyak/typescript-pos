import { CURRENCY, type Currency, PAYMENT_STATUS, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/**
 * Response value mapper of the POSNET JSON gateway. The 3D callback and payment answers carry numeric ISO
 * currency codes while the status answer carries two-letter codes, so `mapCurrency` reads a different table
 * depending on the answer it belongs to.
 */
export class PosNetV1PosResponseValueMapper extends AbstractResponseValueMapper {
  /** Two-letter codes of status answers. */
  protected override currencyMappings: Record<string, Currency> = {
    TL: CURRENCY.TRY,
    US: CURRENCY.USD,
    EU: CURRENCY.EUR,
    GB: CURRENCY.GBP,
    JP: CURRENCY.JPY,
    RU: CURRENCY.RUB,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capture',
    [TX_TYPE.CANCEL]: 'Reverse',
    [TX_TYPE.REFUND]: 'Return',
    [TX_TYPE.REFUND_PARTIAL]: 'Return',
    [TX_TYPE.STATUS]: 'TransactionInquiry',
  }

  protected override orderStatusMappings = {
    [TX_TYPE.PAY_AUTH]: PAYMENT_STATUS.PAYMENT_COMPLETED,
    [TX_TYPE.CANCEL]: PAYMENT_STATUS.CANCELED,
    [TX_TYPE.REFUND]: PAYMENT_STATUS.FULLY_REFUNDED,
  }

  /** Numeric ISO codes of the 3D callback and payment answers. */
  private readonly numericCurrencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }

  override mapCurrency(currency: string | number, apiRequestTxType: TxType | QueryType | null = null): Currency | null {
    if (apiRequestTxType !== TX_TYPE.STATUS) {
      return ownValue(this.numericCurrencyMappings, String(currency)) ?? null
    }

    return super.mapCurrency(currency, apiRequestTxType)
  }
}
