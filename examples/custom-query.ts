// A custom query against the VakıfBank Common Payment API. The merchant credentials are added for you.
// Nothing here runs on import; call the exported function from your own code.
import {
  AccountFactory,
  PosQueryFactory,
  type PosQueryRequestDataPreparedEvent,
  posProductionConfig,
  UnsupportedTransactionTypeError,
} from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount(
  'vakifbank-cp',
  process.env.POS_MERCHANT_ID ?? '',
  process.env.POS_PASSWORD ?? '',
  process.env.POS_TERMINAL_NO ?? '',
)

const query = PosQueryFactory.createPosQuery(account, posProductionConfig, {
  hooks: {
    onPosQueryRequestDataPrepared: [
      (event: PosQueryRequestDataPreparedEvent) => {
        // Log the kind of query only; never log event.requestData, it carries the merchant password.
        console.info(`query ${event.queryType} for ${event.bankName}`)
      },
    ],
  },
})

/** Ask the bank about one transaction. The answer is decoded but not normalized: read the bank's own field names. */
export async function lookupTransaction(transactionId: string) {
  return query.customQuery({ TransactionId: transactionId })
}

/** The query layer rejects what a bank does not offer, so check first or handle the error. */
export async function listHistory() {
  try {
    return await query.history({})
  } catch (error) {
    if (error instanceof UnsupportedTransactionTypeError) return null
    throw error
  }
}
