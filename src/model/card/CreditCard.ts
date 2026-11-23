import type { CardType } from '../../PosInterface.js'

export interface CardExpiration {
  /** Four-digit year, e.g. 2026. */
  year: number
  /** Month 1-12. */
  month: number
}

const pad = (n: number, len: number): string => String(n).padStart(len, '0')

/** Formats an expiration using the PHP date() tokens (Y, y, m, n, d); other chars pass through. */
function formatDate(exp: CardExpiration, format: string): string {
  let out = ''
  for (const ch of format) {
    switch (ch) {
      case 'Y':
        out += pad(exp.year, 4)
        break
      case 'y':
        out += pad(exp.year % 100, 2)
        break
      case 'm':
        out += pad(exp.month, 2)
        break
      case 'n':
        out += String(exp.month)
        break
      case 'd':
        out += '01'
        break
      default:
        out += ch
    }
  }
  return out
}

const INSPECT = Symbol.for('nodejs.util.inspect.custom')

/** PAN and CVV live in private fields and never serialize. */
export class CreditCard {
  readonly #number: string
  readonly #exp: CardExpiration
  readonly #cvv: string
  #holderName: string | null
  readonly #type: CardType | string | null

  constructor(
    number: string,
    expiration: CardExpiration,
    cvv: string,
    holderName: string | null = null,
    type: CardType | string | null = null,
  ) {
    this.#number = number.replace(/\s+/g, '')
    this.#exp = { year: expiration.year, month: expiration.month }
    this.#cvv = cvv
    this.#holderName = holderName
    this.#type = type
  }

  getNumber(): string {
    return this.#number
  }

  getExpirationDate(format: string): string {
    return formatDate(this.#exp, format)
  }

  getExpireYear(format = 'Y'): string {
    return formatDate(this.#exp, format)
  }

  getExpireMonth(format = 'm'): string {
    return formatDate(this.#exp, format)
  }

  getCvv(): string {
    return this.#cvv
  }

  getHolderName(): string | null {
    return this.#holderName
  }

  setHolderName(name: string | null): this {
    this.#holderName = name
    return this
  }

  getType(): CardType | string | null {
    return this.#type
  }

  /** Masked form: first6****last4, no CVV, no expiry. */
  toJSON(): { number: string; holderName: string | null; type: string | null } {
    const n = this.#number
    const masked = n.length >= 10 ? `${n.slice(0, 6)}****${n.slice(-4)}` : '****'
    return { number: masked, holderName: this.#holderName, type: this.#type }
  }

  [INSPECT](): string {
    return `CreditCard ${JSON.stringify(this.toJSON())}`
  }
}
