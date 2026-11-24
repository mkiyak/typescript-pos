export { HttpTransport, type HttpTransportOptions, type HttpTransportResponse } from './client/HttpTransport.js'
export type { ShippedPosConfig } from './config/freezeConfig.js'
export { type PosProductionBank, posProductionConfig } from './config/posProductionConfig.js'
export { type PosTestBank, posTestConfig } from './config/posTestConfig.js'
export type { CryptInterface } from './crypt/CryptInterface.js'
export type { RequestDataMapperInterface } from './data-mapper/request/mapper/RequestDataMapperInterface.js'
export type { RequestValueFormatterInterface } from './data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
export type {
  RecurringFrequency,
  RequestTxTypeMappings,
  RequestValueMapperInterface,
} from './data-mapper/request/value-mapper/RequestValueMapperInterface.js'
export type { ResponseDataMapperInterface } from './data-mapper/response/mapper/ResponseDataMapperInterface.js'
export {
  CardTypeNotSupportedError,
  CardTypeRequiredError,
  GatewayClassNotConfiguredError,
  HashMismatchError,
  InvalidCardError,
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
export { type AbstractGatewayLike, CreditCardFactory } from './factory/CreditCardFactory.js'
export { type PosConfig, PosFactory, type PosFactoryOptions } from './factory/PosFactory.js'
export {
  AbstractGateway,
  type GatewayConfig,
  type GatewayDeps,
  type SupportedTransactions,
} from './gateway/AbstractGateway.js'
export { AssecoPos } from './gateway/AssecoPos.js'
export { PayFlexCPV4Pos } from './gateway/PayFlexCPV4Pos.js'
export { PayFlexV4Pos } from './gateway/PayFlexV4Pos.js'
export { noopLogger, type PosLogger } from './logger.js'
export { AbstractPosAccount } from './model/account/AbstractPosAccount.js'
export { AssecoPosAccount } from './model/account/AssecoPosAccount.js'
export { PayFlexPosAccount } from './model/account/PayFlexPosAccount.js'
export { type CardExpiration, CreditCard } from './model/card/CreditCard.js'
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
export type { EncodedData } from './serializer/EncodedData.js'
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
export const VERSION = '0.2.0'
