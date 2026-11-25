export const LANG = {
  TR: 'tr',
  EN: 'en',
} as const
export type Lang = (typeof LANG)[keyof typeof LANG]

export const TX_TYPE = {
  PAY_AUTH: 'pay',
  PAY_PRE_AUTH: 'pre',
  PAY_POST_AUTH: 'post',
  CANCEL: 'cancel',
  REFUND: 'refund',
  REFUND_PARTIAL: 'refund_partial',
  STATUS: 'status',
  ORDER_HISTORY: 'order_history',
  INTERNAL_3D_FORM_BUILD: '3d_form_build',
  INTERNAL_3D_PAYMENT_STATUS: '3d_payment_status',
} as const
export type TxType = (typeof TX_TYPE)[keyof typeof TX_TYPE]

export const MODEL = {
  THREE_D_SECURE: '3d',
  THREE_D_PAY: '3d_pay',
  THREE_D_PAY_HOSTING: '3d_pay_hosting',
  THREE_D_HOST: '3d_host',
  NON_SECURE: 'regular',
} as const
export type PaymentModel = (typeof MODEL)[keyof typeof MODEL]

export const CURRENCY = {
  TRY: 'TRY',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  JPY: 'JPY',
  RUB: 'RUB',
} as const
export type Currency = (typeof CURRENCY)[keyof typeof CURRENCY]

export const PAYMENT_STATUS = {
  ERROR: 'ERROR',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  CANCELED: 'CANCELED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  FULLY_REFUNDED: 'FULLY_REFUNDED',
  PRE_AUTH_COMPLETED: 'PRE_AUTH_COMPLETED',
} as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

export const FORM_FORMAT = {
  ARRAY: 'array',
  HTML: 'html',
} as const
export type FormFormat = (typeof FORM_FORMAT)[keyof typeof FORM_FORMAT]

/** Funding class of a card. */
export const CARD_CLASS = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  PREPAID: 'prepaid',
} as const
export type CardClass = (typeof CARD_CLASS)[keyof typeof CARD_CLASS]

/** Card programme (family) names the installment queries report. */
export const CARD_FAMILY = {
  WORLD: 'world',
  AXESS: 'axess',
  CARDFINANS: 'cardfinans',
  PARAF: 'paraf',
  ADVANTAGE: 'advantage',
  BONUS: 'bonus',
  MAXIMUM: 'maximum',
  SAGLAMKART: 'saglamkart',
} as const
export type CardFamily = (typeof CARD_FAMILY)[keyof typeof CARD_FAMILY]

export const CARD_TYPE = {
  VISA: 'visa',
  MASTERCARD: 'master',
  AMEX: 'amex',
  TROY: 'troy',
} as const
export type CardType = (typeof CARD_TYPE)[keyof typeof CARD_TYPE]
