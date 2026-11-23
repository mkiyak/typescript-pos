/** Own-property lookup: never returns inherited members such as `constructor` or `toString`. */
export function ownValue<T>(obj: Readonly<Partial<Record<string, T>>>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}
