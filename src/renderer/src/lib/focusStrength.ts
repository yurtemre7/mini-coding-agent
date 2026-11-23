import { useCallback, useState } from 'react'

/** How strongly the message field is highlighted while it has the cursor, in percent. Never fully opaque by default. */
export const DEFAULT_FOCUS_STRENGTH = 60
const KEY = 'mca.focusStrength'

export const clampStrength = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_FOCUS_STRENGTH
}

export function loadFocusStrength(): number {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? DEFAULT_FOCUS_STRENGTH : clampStrength(v)
  } catch {
    return DEFAULT_FOCUS_STRENGTH
  }
}

/** Remembered per user; storage may be unavailable, the value still applies for this run. */
export function useFocusStrength() {
  const [value, setValue] = useState(loadFocusStrength)
  const set = useCallback((v: number) => {
    const n = clampStrength(v)
    setValue(n)
    try {
      localStorage.setItem(KEY, String(n))
    } catch {
      // not persisted
    }
  }, [])
  return { value, set }
}
