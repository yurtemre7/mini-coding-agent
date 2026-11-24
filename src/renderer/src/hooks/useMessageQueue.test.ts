import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMessageQueue } from './useMessageQueue'

const setup = (dispatch = vi.fn(async () => {})) => {
  const hook = renderHook((p: { busy: boolean; scope: string }) => useMessageQueue({ ...p, dispatch }), { initialProps: { busy: true, scope: 'a' } })
  return { ...hook, dispatch }
}

describe('useMessageQueue', () => {
  it('holds messages while busy and sends the first one when the turn ends', async () => {
    const { result, rerender, dispatch } = setup()
    act(() => (result.current.add('one'), result.current.add('two', [{ name: 'a.txt', mime: 'text/plain', data: 'eA==' }])))
    expect(result.current.items.map((m) => m.text)).toEqual(['one', 'two'])
    expect(dispatch).not.toHaveBeenCalled()
    rerender({ busy: false, scope: 'a' })
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('one', undefined))
    expect(result.current.items.map((m) => m.text)).toEqual(['two'])
  })
  it('sends one message per finished turn, in order, never two at once', async () => {
    let done!: () => void
    const dispatch = vi.fn(() => new Promise<void>((r) => (done = r)))
    const { result, rerender } = setup(dispatch)
    act(() => (result.current.add('one'), result.current.add('two')))
    rerender({ busy: false, scope: 'a' })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    rerender({ busy: true, scope: 'a' }) // the first turn started (the app's refresh shows this before dispatch settles)
    await act(async () => done())
    expect(dispatch).toHaveBeenCalledTimes(1)
    rerender({ busy: false, scope: 'a' }) // and ended
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['one', 'two'])
    expect(result.current.items).toEqual([])
  })
  it('does not send again while a dispatch has not settled', async () => {
    let done!: () => void
    const dispatch = vi.fn(() => new Promise<void>((r) => (done = r)))
    const { result, rerender } = setup(dispatch)
    act(() => (result.current.add('one'), result.current.add('two')))
    rerender({ busy: false, scope: 'a' })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    rerender({ busy: false, scope: 'a' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    await act(async () => done())
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
  })
  it('removes and clears queued messages', () => {
    const { result } = setup()
    act(() => (result.current.add('one'), result.current.add('two'), result.current.add('three')))
    act(() => result.current.remove(result.current.items[1].id))
    expect(result.current.items.map((m) => m.text)).toEqual(['one', 'three'])
    act(() => result.current.clear())
    expect(result.current.items).toEqual([])
  })
  it('drops the queue when the workspace changes', () => {
    const { result, rerender } = setup()
    act(() => result.current.add('one'))
    rerender({ busy: true, scope: 'b' })
    expect(result.current.items).toEqual([])
  })
})
