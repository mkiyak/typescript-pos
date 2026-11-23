export { HttpTransport, type HttpTransportOptions, type HttpTransportResponse } from './client/HttpTransport.js'
export { posProductionConfig } from './config/posProductionConfig.js'
export { posTestConfig } from './config/posTestConfig.js'
export {
  CardTypeNotSupportedError,
  CardTypeRequiredError,
  GatewayClassNotConfiguredError,
  HashMismatchError,
  MissingAccountInfoError,
  NotImplementedError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  PosHttpError,
  type PosHttpErrorInfo,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from './errors.js'
export { AccountFactory } from './factory/AccountFactory.js'
export { CreditCardFactory } from './factory/CreditCardFactory.js'
export { type PosConfig, PosFactory, type PosFactoryOptions } from './factory/PosFactory.js'
export { AbstractGateway, type GatewayConfig } from './gateway/AbstractGateway.js'
export { AssecoPos } from './gateway/AssecoPos.js'
export { PayFlexV4Pos } from './gateway/PayFlexV4Pos.js'
export { noopLogger, type PosLogger } from './logger.js'
export { AbstractPosAccount } from './model/account/AbstractPosAccount.js'
export { AssecoPosAccount } from './model/account/AssecoPosAccount.js'
export { PayFlexPosAccount } from './model/account/PayFlexPosAccount.js'
export { CreditCard } from './model/card/CreditCard.js'
export {
  CARD_TYPE,
  type CardType,
  CURRENCY,
  type Currency,
  FORM_FORMAT,
  type FormFormat,
  LANG,
  type Lang,
  MODEL,
  PAYMENT_STATUS,
  type PaymentModel,
  type PaymentStatus,
  TX_TYPE,
  type TxType,
} from './PosInterface.js'
export type {
  Before3DFormHashCalculatedEvent,
  GatewayResponseData,
  PosHooks,
  PosOrder,
  PosResponse,
  RequestDataPreparedEvent,
  ThreeDFormData,
} from './types.js'
export { maskSensitiveData } from './util/maskSensitiveData.js'

/** Library version. Hand-maintained; must equal package.json `version` (enforced by tests/unit/smoke.test.ts). */
export const VERSION = '0.0.0'
