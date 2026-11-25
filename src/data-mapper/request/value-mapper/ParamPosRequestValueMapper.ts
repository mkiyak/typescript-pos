import { CURRENCY, type Currency, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { QUERY_TYPE, type QueryType } from '../../../pos-query/PosQueryInterface.js'
import type { PosOrder } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

/**
 * Param request values: the SOAP operation per transaction type and payment model, the bank's own currency codes
 * and the 3D security flag. The operations that depend on the order (a sale in a foreign currency, the cancel of a
 * pre-authorization) are chosen in `mapTxType`, not listed in the table. There is no language or recurring mapping:
 * those lookups answer "not supported" through the base class.
 */
export class ParamPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: {
      [MODEL.NON_SECURE]: 'TP_WMD_UCD',
      [MODEL.THREE_D_SECURE]: 'TP_WMD_UCD',
      [MODEL.THREE_D_PAY]: 'Pos_Odeme',
      [MODEL.THREE_D_HOST]: 'TO_Pre_Encrypting_OOS',
    },
    [TX_TYPE.PAY_PRE_AUTH]: {
      [MODEL.NON_SECURE]: 'TP_Islem_Odeme_OnProv_WMD',
      [MODEL.THREE_D_SECURE]: 'TP_Islem_Odeme_OnProv_WMD',
    },
    [TX_TYPE.PAY_POST_AUTH]: 'TP_Islem_Odeme_OnProv_Kapa',
    [TX_TYPE.REFUND]: 'TP_Islem_Iptal_Iade_Kismi2',
    [TX_TYPE.REFUND_PARTIAL]: 'TP_Islem_Iptal_Iade_Kismi2',
    [TX_TYPE.CANCEL]: 'TP_Islem_Iptal_Iade_Kismi2',
    [TX_TYPE.STATUS]: 'TP_Islem_Sorgulama4',
    [QUERY_TYPE.HISTORY]: 'TP_Islem_Izleme',
    [QUERY_TYPE.INSTALLMENT_RATES]: 'TP_Ozel_Oran_SK_Liste',
    [QUERY_TYPE.BIN_LIST]: 'BIN_SanalPos',
  }

  protected override currencyMappings: Partial<Record<Currency, string>> = {
    [CURRENCY.TRY]: '1000',
    [CURRENCY.USD]: '1001',
    [CURRENCY.EUR]: '1002',
    [CURRENCY.GBP]: '1003',
  }

  protected override secureTypeMappings: Partial<Record<PaymentModel, string>> = {
    [MODEL.THREE_D_SECURE]: '3D',
    [MODEL.THREE_D_PAY]: '3D',
    [MODEL.NON_SECURE]: 'NS',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  /**
   * A sale of an order in a foreign currency (not the 3D Host model, which has its own operation) goes through the
   * foreign currency operation; only a sale does: the cancel, refund, status and post-authorization requests of
   * such an order use their usual operation. Cancelling a pre-authorization has an operation of its own.
   */
  override mapTxType(
    txType: TxType | QueryType,
    paymentModel: PaymentModel | null = null,
    order: PosOrder | null = null,
  ): string {
    const currency: unknown = order === null || order === undefined ? undefined : ownValue(order, 'currency')
    if (
      txType === TX_TYPE.PAY_AUTH &&
      paymentModel !== MODEL.THREE_D_HOST &&
      currency !== undefined &&
      currency !== null &&
      currency !== CURRENCY.TRY
    ) {
      return 'TP_Islem_Odeme_WD'
    }

    const orderTxType: unknown = order === null || order === undefined ? undefined : ownValue(order, 'transaction_type')
    if (txType === TX_TYPE.CANCEL && orderTxType === TX_TYPE.PAY_PRE_AUTH) {
      return 'TP_Islem_Iptal_OnProv'
    }

    return super.mapTxType(txType, paymentModel)
  }
}
