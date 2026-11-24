import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPrefs } from '../core/trust'
import { type Bounds, createOverlay, defaultBounds, fitBounds, OVERLAY_MIN, type OverlayWindow } from './overlay'

const screen1: Bounds = { x: 0, y: 0, width: 1920, height: 1040 }
const screen2: Bounds = { x: 1920, y: 0, width: 1280, height: 1024 }

function fakeWindow(initial: Bounds) {
  const calls: string[] = []
  const handlers: Record<string, () => void> = {}
  let visible = false
  let focused = false
  let b = initial
  let dead = false
  const w: OverlayWindow & { calls: string[]; handlers: typeof handlers; blur(): void } = {
    calls,
    handlers,
    blur: () => void (focused = false),
    show: () => void (calls.push('show'), (visible = true)),
    hide: () => void (calls.push('hide'), (visible = false), (focused = false)),
    focus: () => void (calls.push('focus'), (focused = true)),
    destroy: () => void (calls.push('destroy'), (dead = true), handlers['closed']?.()),
    isVisible: () => visible,
    isFocused: () => focused,
    isDestroyed: () => dead,
    getBounds: () => b,
    setBounds: (n) => void (b = n),
    setAlwaysOnTop: (f, level) => void calls.push(`onTop:${f}:${level}`),
    setVisibleOnAllWorkspaces: (f, o) => void calls.push(`allSpaces:${f}:${o?.visibleOnFullScreen}`),
    on: (ev, cb) => void (handlers[ev] = cb)
  }
  return w
}

async function setup(platform: NodeJS.Platform = 'win32', registerOk = true) {
  const home = await mkdtemp(join(tmpdir(), 'mca-home-'))
  const made: ReturnType<typeof fakeWindow>[] = []
  const registered = new Map<string, () => void>()
  const warns: string[] = []
  let docks = 0
  const o = createOverlay({
    platform,
    home,
    makeWindow: ({ bounds }) => (made.push(fakeWindow(bounds)), made.at(-1)!),
    shortcuts: { register: (a, cb) => (registerOk ? (registered.set(a, cb), true) : false), unregister: (a) => void registered.delete(a) },
    workAreas: () => [screen1],
    showDock: () => void docks++,
    warn: (m) => void warns.push(m)
  })
  return { o, made, registered, warns, home, docks: () => docks }
}

describe('overlay bounds', () => {
  it('starts in the bottom-right corner of the main screen', () => {
    const b = defaultBounds(screen1)
    expect(b.x + b.width).toBeLessThan(screen1.width)
    expect(b.y + b.height).toBeLessThan(screen1.height)
    expect(fitBounds(undefined, [screen1])).toEqual(b)
  })
  it('keeps a saved position that is still on a screen, also on the second screen', () => {
    const saved = { x: 2000, y: 100, width: 400, height: 500 }
    expect(fitBounds(saved, [screen1, screen2])).toEqual(saved)
  })
  it('falls back to the default when the screen is gone or the numbers are bad', () => {
    const gone = { x: 2000, y: 100, width: 400, height: 500 }
    expect(fitBounds(gone, [screen1])).toEqual(defaultBounds(screen1))
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, [screen1])).toEqual(defaultBounds(screen1))
    expect(fitBounds({ x: NaN, y: 0, width: 400, height: 500 }, [screen1])).toEqual(defaultBounds(screen1))
  })
  it('never makes the window bigger than a small screen', () => {
    const tiny = { x: 0, y: 0, width: 320, height: 300 }
    const b = defaultBounds(tiny)
    expect(b.width).toBeLessThanOrEqual(tiny.width)
    expect(b.width).toBeGreaterThanOrEqual(OVERLAY_MIN.width)
  })
})

describe('overlay manager', () => {
  it('does nothing until it is turned on, and creates the window only when first shown', async () => {
    const { o, made, registered } = await setup()
    await o.toggle()
    expect(made).toHaveLength(0)
    expect(o.apply(true, 'Alt+Shift+M')).toBe(true)
    expect([...registered.keys()]).toEqual(['Alt+Shift+M'])
    expect(made).toHaveLength(0)
    registered.get('Alt+Shift+M')!() // the shortcut
    await new Promise((r) => setTimeout(r, 20))
    expect(made).toHaveLength(1)
    expect(made[0].calls).toEqual(['onTop:true:screen-saver', 'show', 'focus'])
  })
  it('floats over full-screen spaces on macOS and restores the Dock icon', async () => {
    const { o, made, docks } = await setup('darwin')
    o.apply(true)
    await o.toggle()
    expect(made[0].calls).toContain('allSpaces:true:true')
    expect(docks()).toBe(1)
  })
  it('does not use the macOS space call elsewhere', async () => {
    const { o, made } = await setup('linux')
    o.apply(true)
    await o.toggle()
    expect(made[0].calls.some((c) => c.startsWith('allSpaces'))).toBe(false)
  })
  it('the shortcut shows it, focuses it when it is only visible, and hides it when focused', async () => {
    const { o, made } = await setup()
    o.apply(true)
    await o.toggle() // shown and focused
    made[0].blur() // the user clicked back into the game: still visible
    await o.toggle() // pulls it into focus again
    expect(made[0].calls.slice(-2)).toEqual(['show', 'focus'])
    await o.toggle() // focused: hides
    expect(made[0].calls.at(-1)).toBe('hide')
    await o.toggle() // and shows again, same window
    expect(made).toHaveLength(1)
  })
  it('remembers where the user left it, and reopens there', async () => {
    const { o, made, home } = await setup()
    o.apply(true)
    await o.toggle()
    made[0].setBounds({ x: 100, y: 120, width: 420, height: 500 })
    await o.toggle() // hides and saves
    await new Promise((r) => setTimeout(r, 50))
    expect((await loadPrefs(home)).overlayBounds).toEqual({ x: 100, y: 120, width: 420, height: 500 })
    o.apply(false)
    o.apply(true)
    await o.toggle()
    expect(made[1].getBounds()).toEqual({ x: 100, y: 120, width: 420, height: 500 })
  })
  it('turning it off removes the shortcut and the window', async () => {
    const { o, made, registered } = await setup()
    o.apply(true)
    await o.toggle()
    expect(o.apply(false)).toBe(true)
    expect(registered.size).toBe(0)
    expect(made[0].calls.at(-1)).toBe('destroy')
    await o.toggle() // off: nothing happens
    expect(made).toHaveLength(1)
  })
  it('changing the shortcut moves it; a taken shortcut is refused and the old one stays', async () => {
    const { o, registered } = await setup()
    o.apply(true, 'Alt+Shift+M')
    expect(o.apply(true, 'CommandOrControl+Alt+M')).toBe(true)
    expect([...registered.keys()]).toEqual(['CommandOrControl+Alt+M'])
    const taken = await setup('win32', false)
    expect(taken.o.apply(true, 'Alt+Shift+M')).toBe(false)
    expect(taken.warns[0]).toMatch(/already used/)
    await taken.o.toggle() // still off
    expect(taken.made).toHaveLength(0)
  })
  it('hide() hides a visible window and ignores a missing one', async () => {
    const { o, made } = await setup()
    o.hide()
    o.apply(true)
    await o.toggle()
    o.hide()
    expect(made[0].isVisible()).toBe(false)
  })
})
