import { type PaymentModel, TX_TYPE, type TxType } from '../PosInterface.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import { PayFlexV4PosHttpClient } from './PayFlexV4PosHttpClient.js'

/**
 * Status queries. The XML (`SearchRequest`, with a UTF-8
 * XML declaration) is sent form-urlencoded as `prmstr=<xml>` to `query_api`.
 */
export class PayFlexV4PosSearchApiHttpClient extends PayFlexV4PosHttpClient {
  static readonly API_NAME_QUERY_API = 'query_api'

  static override supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PayFlexV4Pos' && apiName === PayFlexV4PosSearchApiHttpClient.API_NAME_QUERY_API
  }

  override supportsTx(txType: TxType, _paymentModel: PaymentModel): boolean {
    return txType === TX_TYPE.STATUS
  }

  protected override encodeXml(requestData: Record<string, unknown>): string {
    return XmlEncoder.encode(requestData, { rootName: 'SearchRequest', encoding: 'UTF-8' })
  }
}
