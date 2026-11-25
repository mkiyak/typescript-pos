import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { TX_TYPE, type TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { toKurus } from '../../../util/toKurus.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export class ParamPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  /** 0 => '1', 1 => '1', 2 => '2': one installment means a single payment. */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '1'
  }

  /**
   * Payments, pre-authorizations and post-authorizations take a comma (`1000,25`); cancels and refunds take a dot
   * (`1000.25`). The text comes from the two-decimal rounding of the amount, so no kuruş is lost to floating point;
   * zero, negative, sub-kuruş, non-finite and absurdly large amounts are refused.
   */
  formatAmount(amount: number, txType: TxType | null = null): string {
    toKurus(amount)
    const text = numberFormat2(amount)
    if (txType === TX_TYPE.CANCEL || txType === TX_TYPE.REFUND || txType === TX_TYPE.REFUND_PARTIAL) {
      return text
    }
    return text.replace('.', ',')
  }

  /** `KK_SK_Ay` is the two-digit month, `KK_SK_Yil` the four-digit year. */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'KK_SK_Yil') {
      return card.getExpirationDate('Y')
    }
    if (fieldName === 'KK_SK_Ay') {
      return card.getExpirationDate('m')
    }
    throw new PosError('Unsupported card expiry field')
  }

  /** `20.11.2018 15:00:00` in Türkiye time, independent of the server zone. */
  formatDateTime(dateTime: Date): string {
    if (!(dateTime instanceof Date) || Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    if (local.getUTCFullYear() < 0 || local.getUTCFullYear() > 9999) {
      throw new PosError('Date year is out of range')
    }
    const day = `${pad(local.getUTCDate(), 2)}.${pad(local.getUTCMonth() + 1, 2)}.${pad(local.getUTCFullYear(), 4)}`
    return `${day} ${pad(local.getUTCHours(), 2)}:${pad(local.getUTCMinutes(), 2)}:${pad(local.getUTCSeconds(), 2)}`
  }
}
