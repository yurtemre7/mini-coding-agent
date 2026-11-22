import { useCallback, useState } from 'react'

/** Shortcuts of the permission and plan dialogs. Allowing something is never bound by default to a bare key: the dialogs contain a text field. */
export type KeyAction = 'permAllowOnce' | 'permAllowSession' | 'permDeny' | 'planApprove' | 'planReject'
export type KeyMap = Record<KeyAction, string>

export const KEY_ACTIONS: { action: KeyAction; group: 'permission' | 'plan'; label: string }[] = [
  { action: 'permAllowOnce', group: 'permission', label: 'Allow once' },
  { action: 'permAllowSession', group: 'permission', label: 'Allow for this session' },
  { action: 'permDeny', group: 'permission', label: 'Deny' },
  { action: 'planApprove', group: 'plan', label: 'Approve plan' },
  { action: 'planReject', group: 'plan', label: 'Reject plan' }
]
export const DEFAULT_KEYS: KeyMap = { permAllowOnce: 'Mod+Enter', permAllowSession: 'Mod+Shift+Enter', permDeny: 'Escape', planApprove: 'Mod+Enter', planReject: 'Escape' }
const STORE = 'mca.keys'
const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MODIFIER_KEYS = ['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'OS']

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/** "Mod+Shift+Enter" style combo of a key event (Mod = Cmd on macOS, Ctrl elsewhere); null for a bare modifier key. */
export function comboOf(e: KeyLike, mac = isMac()): string | null {
  if (MODIFIER_KEYS.includes(e.key)) return null
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  const mod = mac ? e.metaKey : e.ctrlKey
  const stray = mac ? e.ctrlKey : e.metaKey // Ctrl on a Mac, or Win on others: not part of our vocabulary
  if (stray) return null
  return [...(mod ? ['Mod'] : []), ...(e.altKey ? ['Alt'] : []), ...(e.shiftKey ? ['Shift'] : []), key].join('+')
}

/** A combo that is safe while a text field is focused: it needs Mod or Alt, or is Escape or a function key. */
export const isValidCombo = (c: string): boolean => /^(Mod|Alt)\+/.test(c) || c === 'Escape' || /^F([1-9]|1[0-2])$/.test(c)

export function formatCombo(c: string, mac = isMac()): string {
  const symbols: Record<string, string> = { Mod: mac ? '⌘' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift', Enter: mac ? '↵' : 'Enter', Escape: 'Esc' }
  const parts = c.split('+').map((p) => symbols[p] ?? p)
  return mac ? parts.join('') : parts.join('+')
}

/** Another action of the same dialog that already uses this combo. */
export function conflictOf(keys: KeyMap, action: KeyAction, combo: string): KeyAction | undefined {
  const group = KEY_ACTIONS.find((k) => k.action === action)?.group
  return KEY_ACTIONS.find((k) => k.group === group && k.action !== action && keys[k.action] === combo)?.action
}

export function loadKeys(): KeyMap {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Record<KeyAction, unknown>> | null
    const keys = { ...DEFAULT_KEYS }
    if (v && typeof v === 'object') for (const { action } of KEY_ACTIONS) if (typeof v[action] === 'string' && isValidCombo(v[action] as string)) keys[action] = v[action] as string
    // a stored file that makes two actions of one dialog collide falls back to the defaults
    return KEY_ACTIONS.some((k) => conflictOf(keys, k.action, keys[k.action])) ? { ...DEFAULT_KEYS } : keys
  } catch {
    return { ...DEFAULT_KEYS }
  }
}

/** Dialog shortcuts, remembered per user. Storage may be unavailable; they still work for this run. */
export function useKeys() {
  const [keys, setKeys] = useState<KeyMap>(loadKeys)
  const save = useCallback((next: KeyMap) => {
    setKeys(next)
    try {
      localStorage.setItem(STORE, JSON.stringify(next))
    } catch {
      // not persisted
    }
  }, [])
  return {
    keys,
    /** Returns an error message, or null when the combo was accepted. */
    set: (action: KeyAction, combo: string): string | null => {
      if (!isValidCombo(combo)) return `${formatCombo(combo)} needs ${isMac() ? '⌘' : 'Ctrl'} or ${isMac() ? '⌥' : 'Alt'} (or use Esc or a function key), so typing in the message field stays possible.`
      const other = conflictOf(keys, action, combo)
      if (other) return `${formatCombo(combo)} is already used for "${KEY_ACTIONS.find((k) => k.action === other)?.label}".`
      save({ ...keys, [action]: combo })
      return null
    },
    reset: () => save({ ...DEFAULT_KEYS })
  }
}
