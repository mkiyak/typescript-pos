/** Characters stripped by PHP trim(). */
const PHP_TRIM_CHARS = new Set([' ', '\t', '\n', '\r', '\0', '\x0B'])

/** PHP trim(): strips only space, tab, newline, carriage return, NUL and vertical tab from both ends. */
export function phpTrim(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && PHP_TRIM_CHARS.has(value.charAt(start))) start++
  while (end > start && PHP_TRIM_CHARS.has(value.charAt(end - 1))) end--
  return value.slice(start, end)
}
