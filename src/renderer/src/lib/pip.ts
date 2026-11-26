import { useCallback, useState } from 'react'
import { clampPipOpacity, DEFAULT_PIP_OPACITY, PIP_MODES, type McaApi, type PipMode } from '../../../shared/types'

const KEY = 'mca.pipOpacity'
const SIZE_KEY = 'mca.cipSize'

export function loadPipOpacity(): number {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? DEFAULT_PIP_OPACITY : clampPipOpacity(v)
  } catch {
    return DEFAULT_PIP_OPACITY
  }
}

export function loadCipSize(): PipMode {
  try {
    return localStorage.getItem(SIZE_KEY) === 'normal' ? 'normal' : 'phone'
  } catch {
    return 'phone'
  }
}

const save = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    // not persisted
  }
}

/** The CiP (chat in picture) window is the same renderer loaded with `?pip=phone|normal`. */
export function pipModeOf(search: string): PipMode | null {
  const m = new URLSearchParams(search).get('pip')
  return PIP_MODES.includes(m as PipMode) ? (m as PipMode) : null
}

/** Which window this is (main, or CiP in a size), opening/closing CiP, its size and its unfocused opacity (both remembered per user). */
export function usePip(api: McaApi | undefined) {
  const [mode] = useState(() => pipModeOf(window.location.search))
  const [opacity, setValue] = useState(loadPipOpacity)
  const [size, setSizeValue] = useState<PipMode>(() => mode ?? loadCipSize())
  const open = (m: PipMode | 'off') => void api?.invoke('window:pip', m, opacity).catch(() => {})
  const setOpacity = useCallback(
    (v: number) => {
      const n = clampPipOpacity(v)
      setValue(n)
      void api?.invoke('window:pipOpacity', n).catch(() => {})
      save(KEY, String(n))
    },
    [api]
  )
  /** Changing the size while CiP is open reopens it in the new size. */
  const setSize = (m: PipMode) => {
    setSizeValue(m)
    save(SIZE_KEY, m)
    if (mode && mode !== m) open(m)
  }
  /** Opens CiP in the chosen size, or leaves it when this is the CiP window. */
  const toggle = () => open(mode ? 'off' : size)
  return { mode, on: mode !== null, opacity, size, open, toggle, setOpacity, setSize }
}
