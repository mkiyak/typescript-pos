import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`ParamPosAccount.${name} is required.`)
  }
  return value
}

/**
 * Param account: the client code (`CLIENT_CODE`, the merchant id), the API user and password (`CLIENT_USERNAME`,
 * `CLIENT_PASSWORD`), the merchant key (`GUID`, the secret key every request and callback signature is built from)
 * and, for hosted payments, the terminal id (`Terminal_ID`). Blank values are rejected at construction so an empty
 * value is never signed or sent.
 */
export class ParamPosAccount extends AbstractPosAccount {
  constructor(
    bankName: string,
    clientCode: string,
    username: string,
    password: string,
    guid: string,
    terminalId: string | null = null,
  ) {
    super(
      bankName,
      requireNonBlank(clientCode, 'clientCode'),
      requireNonBlank(username, 'username'),
      requireNonBlank(password, 'password'),
      requireNonBlank(guid, 'guid'),
      terminalId === null ? null : requireNonBlank(terminalId, 'terminalId'),
    )
  }
}
