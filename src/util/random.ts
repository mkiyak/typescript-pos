import { randomInt } from 'node:crypto'

const HEX = '0123456789ABCDEF'

/** Cryptographically secure uppercase hex string. */
export function randomHexString(length = 24): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += HEX[randomInt(16)]
  }
  return out
}
