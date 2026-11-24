const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * An element that has attributes but no text and no children (`<MerchantId xsi:nil="true"/>`) is read with an
 * empty text node (`{ '@xsi:nil': 'true', '#': '' }`), so a nil marker and an empty value look the same wherever
 * they come from. The top-level record is left as it is. The caller bounds the depth of the tree.
 */
export function withEmptyElementText(record: Record<string, unknown>): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!isRecord(value)) return value

    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = visit(item)
    const keys = Object.keys(out)
    if (keys.length > 0 && keys.every((key) => key.startsWith('@'))) out['#'] = ''

    return out
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) out[key] = visit(item)

  return out
}
