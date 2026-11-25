import { PosError } from '../../../errors.js'
import type { ToslaPosAccount } from '../../../model/account/ToslaPosAccount.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { toKurus } from '../../../util/toKurus.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** A card number prefix the rate query accepts: exactly six digits. */
const BIN_PATTERN = /^\d{6}$/

/** A 6-digit bin given as text or as a whole number; anything else is refused instead of being signed and sent. */
function requiredBin(params: Record<string, unknown>): string | number {
  const bin = Object.hasOwn(params, 'bin') ? params.bin : undefined
  const valid =
    (typeof bin === 'string' && BIN_PATTERN.test(bin)) ||
    (typeof bin === 'number' && Number.isSafeInteger(bin) && BIN_PATTERN.test(String(bin)))
  if (!valid) {
    throw new PosError('Installment rates need a 6-digit bin')
  }

  return bin as string | number
}

/**
 * Builds the Tosla query requests. Every request carries the client id, the API user, a fresh random value, the
 * Türkiye-time time span and a hash over those four values and the API password (the hash covers no other field).
 * A hook that edits one of the four values after the hash was built makes the request invalid on purpose.
 */
export class ToslaPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<ToslaPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  /**
   * The caller's fields come first and are kept; the account fields, a random value and the time span are added
   * when the caller left them out. The hash is computed over the merged data unless the caller supplied one.
   */
  override createCustomQueryRequestData(
    account: ToslaPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = this.mergeAccountData(requestData, this.createAccountData(account))
    if (Object.hasOwn(merged, 'hash')) {
      return merged
    }
    // the crypt gets a snapshot, so it sees exactly what is sent and cannot alter it
    merged.hash = this.crypt.createHash(account, { ...merged })

    return merged
  }

  /** The commission and installment table of a card; `bin` is the first six digits of the card number. */
  override createInstallmentRatesRequestData(
    account: ToslaPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const bin = requiredBin(params)

    return this.sign(account, { ...this.createAccountData(account), bin })
  }

  /** The installment options of an amount: the caller gives TL, the bank is asked in kuruş. */
  override createInstallmentPricesRequestData(
    account: ToslaPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const amount = toKurus(parseOrderAmount(Object.hasOwn(params, 'amount') ? params.amount : undefined))

    return this.sign(account, { ...this.createAccountData(account), amount, isCommission: 1 })
  }

  private sign(account: ToslaPosAccount, requestData: Record<string, unknown>): Record<string, unknown> {
    return { ...requestData, hash: this.crypt.createHash(account, { ...requestData }) }
  }

  private createAccountData(account: ToslaPosAccount): Record<string, unknown> {
    return {
      clientId: account.getMerchantId(),
      apiUser: account.getUsername(),
      rnd: this.crypt.generateRandomString(),
      timeSpan: this.valueFormatter.formatDateTime(new Date(), 'timeSpan'),
    }
  }
}
