/**
 * Readers for the decoded XML answers of the BOA gateways. Bank answers are data from the network: a field that is
 * not the expected kind (a list, a nested record, an inherited member) reads as absent and never becomes text such
 * as "[object Object]".
 */
export type Raw = Record<string, unknown>

/** The bank prints "no date" as the year-one placeholder. */
export const NO_DATE = /^0001-?01-?01/

export function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Own record child of a record; anything else (missing, list, text, inherited) reads as absent. */
export function child(data: unknown, key: string): Raw | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return isRecord(value) ? value : null
}

/** The first record of a single record or a list of records. */
export function firstRecord(value: unknown): Raw | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null

  return isRecord(value) ? value : null
}

/** A scalar bank field as text; objects, lists, booleans and missing keys read as null. */
export function text(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return null
}

/** A scalar bank field with its type kept (text or number); everything else reads as null. */
export function scalar(data: unknown, key: string): string | number | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return String(value)

  return null
}

/** Own string field exactly as the bank sent it (no trimming): approval decisions are taken on this value only. */
export function exactString(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return typeof value === 'string' && value !== '' ? value : null
}
