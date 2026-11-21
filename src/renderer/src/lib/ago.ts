const UNITS: [string, number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000]
]

export function ago(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms)
  const u = UNITS.find(([, size]) => d >= size)
  return u ? `${Math.floor(d / u[1])}${u[0]} ago` : 'just now'
}
