import type { NonPaymentResponseMapperInterface } from './NonPaymentResponseMapperInterface.js'
import type { PaymentResponseMapperInterface } from './PaymentResponseMapperInterface.js'

export const TX_APPROVED = 'approved'
export const TX_DECLINED = 'declined'

export interface ResponseDataMapperInterface
  extends PaymentResponseMapperInterface,
    NonPaymentResponseMapperInterface {}
