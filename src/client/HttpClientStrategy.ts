import { UnsupportedTransactionTypeError } from '../errors.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { AbstractHttpClient } from './AbstractHttpClient.js'

/** Picks the HTTP client for a transaction type. */
export class HttpClientStrategy {
  constructor(private readonly clients: AbstractHttpClient[]) {}

  getAllClients(): AbstractHttpClient[] {
    return this.clients
  }

  getClient(txType: TxType, paymentModel: PaymentModel): AbstractHttpClient {
    for (const client of this.clients) {
      if (client.supportsTx(txType, paymentModel)) return client
    }
    throw new UnsupportedTransactionTypeError(`No HTTP client configured for transaction type: ${txType}`)
  }
}
