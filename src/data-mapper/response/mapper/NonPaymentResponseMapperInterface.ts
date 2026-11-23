import type { PosResponse } from '../../../types.js'

export interface NonPaymentResponseMapperInterface {
  mapRefundResponse(rawResponseData: Record<string, unknown>): PosResponse

  mapCancelResponse(rawResponseData: Record<string, unknown>): PosResponse

  mapStatusResponse(rawResponseData: Record<string, unknown>): PosResponse

  mapOrderHistoryResponse(rawResponseData: Record<string, unknown>): PosResponse
}
