import { NotImplementedError, PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/** The bank's order number field is 20 characters wide; lookups and reversals use 24 (prefix included). */
const ORDER_ID_LENGTH = 20
const ORDER_ID_TOTAL_LENGTH = 24
const ORDER_ID_3D_PREFIX = 'TDSC'

/**
 * Only characters that are safe in the raw form body and the signed strings: the id is posted unescaped and signed
 * as UTF-8, so `&`, `%` and non-ASCII must never get through.
 */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/

const LOOKUP_TX_TYPES: readonly TxType[] = [TX_TYPE.STATUS, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL, TX_TYPE.CANCEL]

export class PosNetPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }

  /** 0 => '00', 1 => '00', 2 => '02' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment).padStart(2, '0') : '00'
  }

  /** The amount in kuruş: 10.01 => 1001. Rounded like a two-decimal money format, never truncated (1.13 => 113). */
  formatAmount(amount: number, _txType: TxType | null = null): number {
    return Number(numberFormat2(amount).replace('.', ''))
  }

  /** Two-digit year and month: 2404 */
  formatCardExpDate(card: CreditCard, _fieldName: string): string {
    return card.getExpirationDate('ym')
  }

  formatDateTime(_dateTime: Date, _fieldName: string | null = null): string {
    throw new NotImplementedError('PosNetPos requests carry no date.')
  }

  /**
   * Left-pads the id with zeros to 20 characters. Status, cancel and refund requests need 24 characters: the
   * bank's own 3D payments are stored under the `TDSC` prefix, every other order has none.
   */
  formatOrderId(orderId: string, txType: TxType | null = null, orderPaymentModel: PaymentModel | null = null): string {
    if (typeof orderId !== 'string' || !ORDER_ID_PATTERN.test(orderId)) {
      throw new PosError(
        `The order id must be 1 to ${ORDER_ID_LENGTH} characters of letters, digits, "_" or "-" (got ${
          typeof orderId === 'string' ? `${orderId.length} characters` : typeof orderId
        }).`,
      )
    }

    let prefix = ''
    let padLength = ORDER_ID_LENGTH
    if (txType !== null && LOOKUP_TX_TYPES.includes(txType)) {
      padLength = ORDER_ID_TOTAL_LENGTH
      if (orderPaymentModel === MODEL.THREE_D_SECURE) {
        prefix = ORDER_ID_3D_PREFIX
      }
    }

    return prefix + orderId.padStart(padLength - prefix.length, '0')
  }
}
