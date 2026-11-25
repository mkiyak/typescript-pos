import type { NonPaymentResponseMapperInterface } from './NonPaymentResponseMapperInterface.js'
import type { PaymentResponseMapperInterface } from './PaymentResponseMapperInterface.js'

export const TX_APPROVED = 'approved'
export const TX_DECLINED = 'declined'

export interface ResponseDataMapperInterface extends PaymentResponseMapperInterface, NonPaymentResponseMapperInterface {
  /**
   * The bank's result code of a raw answer, read exactly as the mapper decides on it, or null when the answer carries
   * none (missing, empty, or not one plain value). The gateway calls it on the answer to a request that can move money
   * (payment, pre-/post-authorization, 3D provision, refund) before mapping: an answer without a result code says
   * nothing about the money, so the outcome is unknown instead of declined.
   */
  readProcReturnCode(raw: Record<string, unknown>): string | null
}
