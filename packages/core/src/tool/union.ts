/** Merge two tool lists by name; same-name entries from `override` win. */
export function unionByName<T extends { name: string }>(
  base: T[] | undefined,
  override: T[] | undefined,
): T[] | undefined {
  if (!base && !override) return undefined
  const map = new Map<string, T>()
  for (const t of base ?? []) map.set(t.name, t)
  for (const t of override ?? []) map.set(t.name, t)
  return Array.from(map.values())
}
