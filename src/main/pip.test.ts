import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ screen: {} }))
const { pipBounds, usableBounds } = await import('./pip')

describe('pipBounds', () => {
  it('phone: portrait box in the bottom-right corner that fits the work area', () => {
    expect(pipBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({ x: 1514, y: 180, width: 390, height: 844 })
    const small = pipBounds({ x: 100, y: 0, width: 1280, height: 700 })
    expect(small.height).toBe(668)
    expect(small.width).toBe(Math.round((390 * 668) / 844))
    expect(small.x + small.width).toBe(100 + 1280 - 16)
  })
  it('reuses a remembered box only while it is still on a display and not too small', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const r = { x: 100, y: 100, width: 640, height: 400 }
    expect(usableBounds(r, [area])).toEqual(r)
    expect(usableBounds({ ...r, x: 3000 }, [area])).toBeNull() // that monitor is gone
    expect(usableBounds({ ...r, width: 50 }, [area])).toBeNull()
    expect(usableBounds({ x: 'a' }, [area])).toBeNull()
    expect(usableBounds(undefined, [area])).toBeNull()
  })
})
