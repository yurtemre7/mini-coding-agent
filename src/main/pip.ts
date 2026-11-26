import { readFileSync, writeFileSync } from 'node:fs'
import { type BrowserWindow, type Rectangle, screen } from 'electron'
import type { PipMode } from '../shared/types'

/** Phone CiP: portrait 404 x 710 at most (the size the user settled on). (Normal CiP starts at the main window's size and place.) */
const PHONE = { width: 404, height: 710 }

/** A phone-ratio box in the bottom-right corner of the work area, shrunk to fit. Pure, so it is testable without Electron. */
export function pipBounds(area: Rectangle, margin = 16): Rectangle {
  const max = PHONE
  const scale = Math.min(1, (area.height - 2 * margin) / max.height, (area.width - 2 * margin) / max.width)
  const width = Math.round(max.width * scale)
  const height = Math.round(max.height * scale)
  return { x: area.x + area.width - width - margin, y: area.y + area.height - height - margin, width, height }
}

let pip: { win: BrowserWindow; mode: PipMode } | null = null
let opacity = 1

/** Last position and size of each CiP size, kept across launches in `file`. */
let remembered: Partial<Record<PipMode, Rectangle>> = {}
let file: string | undefined

const isRect = (r: unknown): r is Rectangle => !!r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((r as Record<string, unknown>)[k]))

/** A remembered box is used only if it still overlaps a display's work area (a monitor may be gone). Pure, so it is testable. */
export function usableBounds(saved: unknown, areas: Rectangle[]): Rectangle | null {
  if (!isRect(saved) || saved.width < 200 || saved.height < 150) return null
  const overlaps = areas.some((a) => saved.x < a.x + a.width - 50 && saved.x + saved.width > a.x + 50 && saved.y < a.y + a.height - 50 && saved.y + saved.height > a.y)
  return overlaps ? saved : null
}

/** Loads remembered CiP bounds; a missing or corrupt file means none. */
export function initPipBounds(path: string): void {
  file = path
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    remembered = Object.fromEntries(PIP_MODES_LIST.filter((m) => isRect(v[m])).map((m) => [m, v[m]]))
  } catch {
    remembered = {}
  }
}

const PIP_MODES_LIST: PipMode[] = ['phone', 'normal']

function remember(mode: PipMode, win: BrowserWindow): void {
  if (win.isDestroyed()) return
  remembered[mode] = win.getBounds()
  if (!file) return
  try {
    writeFileSync(file, JSON.stringify(remembered))
  } catch {
    // not persisted; still remembered for this run
  }
}

/** The open picture-in-picture window and its mode, if any. */
export const currentPip = (): { win: BrowserWindow; mode: PipMode } | null => (pip && !pip.win.isDestroyed() ? pip : null)

/** Opacity while the picture-in-picture window is not focused (already clamped by the validator). */
export function setPipOpacity(v: number): void {
  opacity = v
  const p = currentPip()
  if (p && !p.win.isFocused()) p.win.setOpacity(v)
}

/**
 * Opens a frameless, always-on-top chat window (`make` loads the renderer in PiP mode) and hides the main window; 'off' closes it and shows the main window again.
 * Switching between phone and normal replaces the window.
 */
export function setPip(main: BrowserWindow, mode: PipMode | 'off', make: (mode: PipMode, bounds: Rectangle) => BrowserWindow): void {
  const open = currentPip()
  if (open && open.mode === mode) return open.win.focus()
  if (open) {
    pip = null
    remember(open.mode, open.win)
    open.win.destroy()
  }
  if (mode === 'off') {
    if (main.isDestroyed()) return
    main.show()
    main.focus()
    return
  }
  const fallback = mode === 'normal' ? main.getNormalBounds() : pipBounds(screen.getDisplayMatching(main.getBounds()).workArea)
  const bounds = usableBounds(remembered[mode], screen.getAllDisplays().map((d) => d.workArea)) ?? fallback
  const win = make(mode, bounds)
  pip = { win, mode }
  win.setAlwaysOnTop(true, 'floating')
  win.on('blur', () => !win.isDestroyed() && win.setOpacity(opacity)) // setOpacity has no effect on Linux
  win.on('focus', () => win.setOpacity(1))
  win.on('close', () => remember(mode, win))
  // closed by the user (Alt+F4, taskbar): the main window comes back
  win.on('closed', () => {
    if (pip?.win !== win) return
    pip = null
    if (!main.isDestroyed()) main.show()
  })
  main.hide()
}
