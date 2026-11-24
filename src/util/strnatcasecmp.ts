/**
 * Same result as PHP's strnatcasecmp().
 *
 * Reference: php-src ext/standard/strnatcmp.c (PHP 8.x), functions
 * compare_right(), compare_left() and strnatcmp_ex(a, b, fold_case = 1).
 * Original algorithm by Martin Pool (strnatcmp.c). Operates on UTF-8 bytes
 * like the C implementation; case folding is ASCII-only toupper().
 */

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39
// C isspace(): space, \t \n \v \f \r
const isSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d)
const toUpper = (c: number): number => (c >= 0x61 && c <= 0x7a ? c - 0x20 : c)

type Cursor = { buf: Buffer; i: number }

// Reading past the end yields 0, like the NUL terminator in C.
const at = (s: Cursor): number => (s.i < s.buf.length ? (s.buf[s.i] as number) : 0)
const digitAt = (s: Cursor): boolean => s.i < s.buf.length && isDigit(s.buf[s.i] as number)

function compareRight(a: Cursor, b: Cursor): number {
  let bias = 0
  // The longest run of digits wins. Otherwise the greatest value wins, but that is only
  // known after scanning both runs, so remember it in `bias`.
  for (; ; a.i++, b.i++) {
    const da = digitAt(a)
    const db = digitAt(b)
    if (!da && !db) return bias
    if (!da) return -1
    if (!db) return 1
    const ca = at(a)
    const cb = at(b)
    if (ca < cb) {
      if (!bias) bias = -1
    } else if (ca > cb) {
      if (!bias) bias = 1
    }
  }
}

function compareLeft(a: Cursor, b: Cursor): number {
  // Compare left-aligned (fractional) digit runs: first difference wins.
  for (; ; a.i++, b.i++) {
    const da = digitAt(a)
    const db = digitAt(b)
    if (!da && !db) return 0
    if (!da) return -1
    if (!db) return 1
    const ca = at(a)
    const cb = at(b)
    if (ca < cb) return -1
    if (ca > cb) return 1
  }
}

export function strnatcasecmp(a: string, b: string): number {
  const A: Cursor = { buf: Buffer.from(a, 'utf8'), i: 0 }
  const B: Cursor = { buf: Buffer.from(b, 'utf8'), i: 0 }
  const aLen = A.buf.length
  const bLen = B.buf.length

  if (aLen === 0 || bLen === 0) {
    return aLen === bLen ? 0 : aLen > bLen ? 1 : -1
  }

  // Skip leading zeros (only at the very start of the strings).
  while (at(A) === 0x30 && A.i + 1 < aLen && isDigit(A.buf[A.i + 1] as number)) A.i++
  while (at(B) === 0x30 && B.i + 1 < bLen && isDigit(B.buf[B.i + 1] as number)) B.i++

  for (;;) {
    let ca = at(A)
    let cb = at(B)

    // Skip consecutive whitespace.
    while (isSpace(ca)) {
      A.i++
      ca = at(A)
    }
    while (isSpace(cb)) {
      B.i++
      cb = at(B)
    }

    // Process a run of digits.
    if (isDigit(ca) && isDigit(cb)) {
      const fractional = ca === 0x30 || cb === 0x30
      const result = fractional ? compareLeft(A, B) : compareRight(A, B)
      if (result !== 0) return result
      if (A.i >= aLen && B.i >= bLen) return 0
      if (A.i >= aLen) return -1
      if (B.i >= bLen) return 1
      ca = at(A)
      cb = at(B)
    }

    ca = toUpper(ca)
    cb = toUpper(cb)
    if (ca < cb) return -1
    if (ca > cb) return 1

    A.i++
    B.i++
    if (A.i >= aLen && B.i >= bLen) return 0
    if (A.i >= aLen) return -1
    if (B.i >= bLen) return 1
  }
}
