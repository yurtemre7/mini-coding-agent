import type { McaApi } from '../../../shared/types'
import { resized, type Corner } from '@/lib/resized'

/** Bottom-left and bottom-right grips that resize the frameless CiP window (its thin native edges are hard to hit). */
export function CipResizeGrips({ api }: { api: McaApi }) {
  const grip = (corner: Corner) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const start = { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }
    const [sx, sy] = [e.screenX, e.screenY]
    let frame = 0
    const move = (m: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => void api.invoke('window:cipBounds', resized(start, corner, m.screenX - sx, m.screenY - sy)).catch(() => {}))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const cls = 'fixed bottom-0 z-50 h-4 w-4'
  const style = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  return (
    <>
      <div aria-hidden title="Resize" className={`${cls} left-0 cursor-nesw-resize`} style={style} onPointerDown={grip('left')} />
      <div aria-hidden title="Resize" className={`${cls} right-0 cursor-nwse-resize bg-[linear-gradient(135deg,transparent_55%,var(--color-muted-foreground)_55%,var(--color-muted-foreground)_62%,transparent_62%,transparent_75%,var(--color-muted-foreground)_75%,var(--color-muted-foreground)_82%,transparent_82%)] opacity-60`} style={style} onPointerDown={grip('right')} />
    </>
  )
}
