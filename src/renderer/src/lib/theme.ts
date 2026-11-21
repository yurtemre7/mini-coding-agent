import { useCallback, useEffect, useState } from 'react'

export const THEME_PREFS = ['system', 'light', 'dark'] as const
export type ThemePref = (typeof THEME_PREFS)[number]
const KEY = 'mca.theme'
const QUERY = '(prefers-color-scheme: dark)'

export const isThemePref = (v: unknown): v is ThemePref => (THEME_PREFS as readonly unknown[]).includes(v)

/** Storage can throw (private mode, blocked site data): the app must still render, following the OS. */
export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return isThemePref(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    // not persisted; still applied for this run
  }
}

const systemDark = (): boolean => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false)

export const resolveTheme = (pref: ThemePref, prefersDark: boolean): 'light' | 'dark' => (pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref)

/** Sets the `dark` class (the tokens in index.css hang off it) and `color-scheme` (native scrollbars, form controls). */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): 'light' | 'dark' {
  return applyResolved(resolveTheme(pref, systemDark()), root)
}

function applyResolved(theme: 'light' | 'dark', root: HTMLElement = document.documentElement): 'light' | 'dark' {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  return theme
}

export const nextThemePref = (p: ThemePref): ThemePref => THEME_PREFS[(THEME_PREFS.indexOf(p) + 1) % THEME_PREFS.length]

/** The stored preference, kept applied; while it is "system" the app follows the OS live. */
export function useTheme(): { pref: ThemePref; theme: 'light' | 'dark'; setPref(p: ThemePref): void } {
  const [pref, setPrefState] = useState<ThemePref>(loadThemePref)
  const [prefersDark, setPrefersDark] = useState(systemDark)
  const theme = resolveTheme(pref, prefersDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QUERY)
    const onChange = () => setPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => void applyResolved(theme), [theme])
  const setPref = useCallback((p: ThemePref) => (saveThemePref(p), setPrefState(p)), [])
  return { pref, theme, setPref }
}
