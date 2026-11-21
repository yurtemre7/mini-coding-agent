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
  it('posts only the message to an http(s) push URL, and ignores other schemes and failures', async () => {
    const fetch = vi.fn(async () => new Response('ok'))
    createNotifier({ desktop: vi.fn(), focused: () => true, url: 'https://ntfy.sh/my-topic', fetch })('MCA may be stuck in a loop.')
    expect(fetch).toHaveBeenCalledWith('https://ntfy.sh/my-topic', expect.objectContaining({ method: 'POST', body: 'MCA may be stuck in a loop.' }))
    const other = vi.fn()
    createNotifier({ desktop: vi.fn(), focused: () => true, url: 'file:///etc/passwd', fetch: other as never })('x')
    expect(other).not.toHaveBeenCalled()
    const failing = vi.fn(async () => { throw new Error('offline') })
    expect(() => createNotifier({ desktop: () => { throw new Error('no service') }, focused: () => false, url: 'http://x', fetch: failing as never })('y')).not.toThrow()
  })
})
