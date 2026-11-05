/** Short, collision-resistant id (time-sortable prefix + random). */
export function uid(prefix = ''): string {
  const t = Date.now().toString(36)
  const r =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}${t}${r}`
}
