import { describe, expect, it } from 'vitest'
import { resized } from '@/lib/resized'

describe('CiP resize grips', () => {
  const start = { x: 1000, y: 200, width: 400, height: 600 }
  it('bottom-right grows right and down, keeping the top-left corner', () => {
    expect(resized(start, 'right', 50, 30)).toEqual({ x: 1000, y: 200, width: 450, height: 630 })
  })
  it('bottom-left grows left, keeping the right edge in place', () => {
    expect(resized(start, 'left', -100, 0)).toEqual({ x: 900, y: 200, width: 500, height: 600 })
  })
  it('never shrinks below 280 x 240, and the right edge stays put when clamped', () => {
    const r = resized(start, 'left', 500, -1000)
    expect([r.width, r.height, r.x + r.width]).toEqual([280, 240, 1400])
  })
})
