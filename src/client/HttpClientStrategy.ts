import { UnsupportedTransactionTypeError } from '../errors.js'
import type { PaymentModel } from '../PosInterface.js'
import type { AbstractHttpClient, ClientTxType } from './AbstractHttpClient.js'

/** Picks the HTTP client for a transaction type. */
export class HttpClientStrategy {
  constructor(private readonly clients: AbstractHttpClient[]) {}

  getAllClients(): AbstractHttpClient[] {
    return this.clients
  }

  getClient(txType: ClientTxType, paymentModel: PaymentModel): AbstractHttpClient {
    for (const client of this.clients) {
      if (client.supportsTx(txType, paymentModel)) return client
    }
    throw new UnsupportedTransactionTypeError(`No HTTP client configured for transaction type: ${txType}`)
  }
}
