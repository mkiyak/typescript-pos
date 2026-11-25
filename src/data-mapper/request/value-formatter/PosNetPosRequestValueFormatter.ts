import { NotImplementedError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { existingOrderIdOf } from '../../../util/orderId.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/** The bank's order number field is 20 characters wide; lookups and reversals use 24 (prefix included). */
export const ORDER_ID_LENGTH = 20
const ORDER_ID_TOTAL_LENGTH = 24

const LOOKUP_TX_TYPES: readonly TxType[] = [TX_TYPE.STATUS, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL, TX_TYPE.CANCEL]

export class PosNetPosRequestValueFormatter implements RequestValueFormatterInterface {
  /** The bank keeps its own 3D payments under this prefix; the sibling JSON API uses another one. */
  protected readonly threeDPrefix: string = 'TDSC'

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
    // Read as an existing id: lookups, reversals and callbacks of orders created before the shared order id rule
    // must keep working, so the mappers check new payments against that rule themselves. The bank's field holds 20
    // characters; the XML client refuses `&`, `%` and characters outside ISO-8859-9 in the raw form body.
    const id = existingOrderIdOf({ id: orderId }, ORDER_ID_LENGTH)

    let prefix = ''
    let padLength = ORDER_ID_LENGTH
    if (txType !== null && LOOKUP_TX_TYPES.includes(txType)) {
      padLength = ORDER_ID_TOTAL_LENGTH
      if (orderPaymentModel === MODEL.THREE_D_SECURE) {
        prefix = this.threeDPrefix
      }
    }

    return prefix + id.padStart(padLength - prefix.length, '0')
  }
}
