import { loadPrefs, savePrefs } from '../core/trust'
import { DEFAULT_OVERLAY_SHORTCUT } from '../shared/types'

export interface Bounds { x: number; y: number; width: number; height: number }

export const OVERLAY_SIZE = { width: 400, height: 560 }
export const OVERLAY_MIN = { width: 300, height: 260 }
const MARGIN = 24
const VISIBLE = 80 // at least this much of the window must stay on a screen

const overlaps = (a: Bounds, b: Bounds) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= VISIBLE && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= VISIBLE

/** The bottom-right corner of a screen, where the chat starts out. */
export const defaultBounds = (area: Bounds): Bounds => {
  const width = Math.min(OVERLAY_SIZE.width, area.width)
  const height = Math.min(OVERLAY_SIZE.height, area.height)
  return { x: area.x + area.width - width - MARGIN, y: area.y + area.height - height - MARGIN, width, height }
}

/** Keeps the saved position only while it is still on a screen (a monitor may have been unplugged); otherwise the default spot. */
export function fitBounds(saved: Bounds | undefined, areas: Bounds[]): Bounds {
  const first = areas[0] ?? { x: 0, y: 0, width: 1280, height: 800 }
  const ok = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width >= OVERLAY_MIN.width && saved.height >= OVERLAY_MIN.height
  return ok && areas.some((a) => overlaps(saved, a)) ? saved : defaultBounds(first)
}

export interface OverlayWindow {
  show(): void
  hide(): void
  focus(): void
  destroy(): void
  isVisible(): boolean
  isFocused(): boolean
  isDestroyed(): boolean
  getBounds(): Bounds
  setBounds(b: Bounds): void
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void
  setVisibleOnAllWorkspaces(flag: boolean, opts?: { visibleOnFullScreen?: boolean }): void
  on(event: 'moved' | 'resized' | 'closed', cb: () => void): void
}

export interface OverlayDeps {
  platform: NodeJS.Platform
  home?: string
  /** Creates the hidden window (frameless, opaque, with the overlay view loaded). */
  makeWindow(options: { bounds: Bounds; min: { width: number; height: number }; panel: boolean }): OverlayWindow
  shortcuts: { register(accelerator: string, cb: () => void): boolean; unregister(accelerator: string): void }
  /** Usable area of each screen, the primary one first. */
  workAreas(): Bounds[]
  /** macOS hides the Dock icon while a window floats over full-screen apps; this brings it back. */
  showDock?(): void
  /** Notified when the shortcut could not be used (taken by another app). */
  warn?(message: string): void
}

/**
 * The small floating chat: an always-on-top window that is hidden until its shortcut is pressed.
 * Over borderless and windowed full-screen apps it stays visible; over exclusive full screen the operating system does not allow it.
 */
export function createOverlay(d: OverlayDeps) {
  let win: OverlayWindow | undefined
  let enabled = false
  let shortcut: string | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const save = () => {
    if (!win || win.isDestroyed()) return
    void savePrefs({ overlayBounds: win.getBounds() }, d.home).catch(() => {})
  }
  const later = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 400)
  }
  const drop = () => {
    clearTimeout(saveTimer)
    if (win && !win.isDestroyed()) win.destroy()
    win = undefined
  }

  async function ensure(): Promise<OverlayWindow> {
    if (win && !win.isDestroyed()) return win
    const bounds = fitBounds((await loadPrefs(d.home)).overlayBounds, d.workAreas())
    const w = d.makeWindow({ bounds, min: OVERLAY_MIN, panel: d.platform === 'darwin' })
    w.setAlwaysOnTop(true, 'screen-saver') // above borderless full-screen apps
    if (d.platform === 'darwin') {
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) // and above full-screen Spaces
      d.showDock?.()
    }
    w.on('moved', later)
    w.on('resized', later)
    w.on('closed', () => (win === w ? (win = undefined) : undefined))
    win = w
    return w
  }

  /** Shows the chat and puts the cursor in it; pressing the shortcut again hides it, which returns focus to the app underneath. */
  async function toggle(): Promise<void> {
    if (!enabled) return
    const w = await ensure()
    if (w.isVisible() && w.isFocused()) {
      save()
      w.hide()
    } else {
      w.show()
      w.focus()
    }
  }

  return {
    toggle,
    hide(): void {
      if (win && !win.isDestroyed() && win.isVisible()) {
        save()
        win.hide()
      }
    },
    /** Turns the feature on or off and moves its shortcut. Returns false, changing nothing, when the shortcut is not available. */
    apply(on: boolean, accelerator: string = DEFAULT_OVERLAY_SHORTCUT): boolean {
      if (!on) {
        if (shortcut) d.shortcuts.unregister(shortcut)
        shortcut = null
        enabled = false
        drop()
        return true
      }
      if (shortcut !== accelerator) {
        if (!d.shortcuts.register(accelerator, () => void toggle())) {
          d.warn?.('That shortcut is already used by another app. Choose a different one.')
          return false
        }
        if (shortcut) d.shortcuts.unregister(shortcut)
        shortcut = accelerator
      }
      enabled = true
      return true
    },
    dispose(): void {
      if (shortcut) d.shortcuts.unregister(shortcut)
      shortcut = null
      enabled = false
      drop()
    }
  }
}
export type Overlay = ReturnType<typeof createOverlay>
