import { describe, expect, it, vi } from 'vitest'
import { createNotifier } from './notify'

describe('createNotifier', () => {
  it('shows a desktop notification only while the app is in the background', () => {
    const desktop = vi.fn()
    let focused = true
    const n = createNotifier({ desktop, focused: () => focused })
    n('stuck')
    expect(desktop).not.toHaveBeenCalled()
    focused = false
    n('stuck')
    expect(desktop).toHaveBeenCalledWith('MCA', 'stuck')
  })
  it('a failing notification service does not throw', () => {
    expect(() => createNotifier({ desktop: () => { throw new Error('no service') }, focused: () => false })('y')).not.toThrow()
  })
})
