import type { TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'

export interface PaymentResponseMapperInterface {
  mapPaymentResponse(rawPaymentResponseData: Record<string, unknown>, txType: TxType, order: PosOrder): PosResponse

  /** @param rawPaymentResponseData null when the provision request was not made */
  map3DPaymentData(
    raw3DAuthResponseData: Record<string, unknown>,
    rawPaymentResponseData: Record<string, unknown> | null,
    txType: TxType,
    order: PosOrder,
  ): PosResponse

  map3DPayResponseData(raw3DAuthResponseData: Record<string, unknown>, txType: TxType, order: PosOrder): PosResponse

  map3DHostResponseData(raw3DAuthResponseData: Record<string, unknown>, txType: TxType, order: PosOrder): PosResponse

  /** Extracts the MD / 3D auth status (numeric string) from a 3D auth response. */
  extractMdStatus(raw3DAuthResponseData: Record<string, unknown>): string | null

  is3dAuthSuccess(mdStatus: string | null): boolean
}
