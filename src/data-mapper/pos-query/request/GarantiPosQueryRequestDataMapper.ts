import { PosError } from '../../../errors.js'
import type { GarantiPosAccount } from '../../../model/account/GarantiPosAccount.js'
import { CURRENCY } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { requiredString } from '../../../util/required.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

const API_VERSION = '512'

const BIN_LIST_API_VERSION = 'v0.1'

/** Marks an e-commerce (not mail order) transaction. */
const MOTO = 'N'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function requiredDate(data: Record<string, unknown>, key: string): Date {
  const value = data[key]
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PosError(`Query field "${key}" must be a valid Date`)
  }
  return value
}

/** Builds the Garanti (GVP) query requests: every one carries the provisioning user terminal and its signature. */
export class GarantiPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<GarantiPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  /**
   * Adds mode, version and terminal when the caller left them out and signs the request when its terminal carries no
   * signature yet. The caller's objects are never modified.
   */
  override createCustomQueryRequestData(
    account: GarantiPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = this.mergeAccountData(requestData, {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
    })

    if (!isPlainObject(result.Terminal)) {
      throw new PosError('Query field "Terminal" must be an object')
    }
    const terminal: Record<string, unknown> = { ...result.Terminal }
    result.Terminal = terminal

    if (typeof terminal.HashData !== 'string' || terminal.HashData === '') {
      return this.sign(account, result)
    }

    return result
  }

  override createHistoryRequestData(
    account: GarantiPosAccount,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const txType = QUERY_TYPE.HISTORY

    const result: Record<string, unknown> = {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: { IPAddress: requiredString(data, 'ip', 'Query') },
      Order: {
        OrderID: null,
        GroupID: null,
        Description: null,
        StartDate: this.valueFormatter.formatDateTime(requiredDate(data, 'start_date'), 'StartDate', txType),
        EndDate: this.valueFormatter.formatDateTime(requiredDate(data, 'end_date'), 'EndDate', txType),
        ListPageNum: data.page ?? 1,
      },
      Transaction: {
        Type: this.valueMapper.mapTxType(txType),
        Amount: this.valueFormatter.formatAmount(1),
        CurrencyCode: this.valueMapper.mapCurrency(CURRENCY.TRY),
        CardholderPresentCode: '0',
        MotoInd: MOTO,
      },
    }

    return this.sign(account, result)
  }

  override createBinListRequestData(
    account: GarantiPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const txType = QUERY_TYPE.BIN_LIST

    const binInquiry: Record<string, unknown> = {
      // Group: A all, G Garanti, B Bonusnet.
      Group: 'A',
      // CardType: A all, C credit, D debit.
      CardType: this.valueMapper.mapCardClass((params.card_class as string | null | undefined) ?? null),
    }
    if (params.bin !== undefined && params.bin !== null) {
      binInquiry.BINNum = String(params.bin)
    }

    const result: Record<string, unknown> = {
      Mode: this.getMode(),
      Version: BIN_LIST_API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: { IPAddress: requiredString(params, 'ip', 'Query') },
      Order: { OrderID: this.crypt.generateRandomString() },
      Transaction: {
        Type: this.valueMapper.mapTxType(txType),
        Amount: this.valueFormatter.formatAmount(1),
        BINInq: binInquiry,
      },
    }

    return this.sign(account, result)
  }

  /** The hash is computed over the data as it is (the terminal's `HashData` is empty or absent); the result is a copy
   * that carries the hash, so the hashed object is left untouched. */
  private sign(account: GarantiPosAccount, result: Record<string, unknown>): Record<string, unknown> {
    const hash = this.crypt.createHash(account, result)
    return { ...result, Terminal: { ...(result.Terminal as Record<string, unknown>), HashData: hash } }
  }

  private getMode(): string {
    return this.isTestMode() ? 'TEST' : 'PROD'
  }

  private getTerminalData(account: GarantiPosAccount): Record<string, string> {
    return {
      ProvUserID: account.getUsername(),
      UserID: account.getUsername(),
      HashData: '',
      ID: account.getTerminalId(),
      MerchantID: account.getMerchantId(),
    }
  }
}
