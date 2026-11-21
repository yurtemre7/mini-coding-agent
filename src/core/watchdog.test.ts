import { describe, expect, it } from 'vitest'
import { LoopDetector } from './watchdog'

const call = (path: string) => [{ name: 'Read', input: { file_path: path } }]

describe('LoopDetector', () => {
  it('fires on the third identical batch in a row and starts counting again', () => {
    const d = new LoopDetector(3)
    expect([d.record(call('a')), d.record(call('a')), d.record(call('a')), d.record(call('a')), d.record(call('a')), d.record(call('a'))]).toEqual([false, false, true, false, false, true])
  })
  it('a different call, or a different input, resets the count', () => {
    const d = new LoopDetector(3)
    expect([d.record(call('a')), d.record(call('a')), d.record(call('b')), d.record(call('a')), d.record(call('a'))]).toEqual([false, false, false, false, false])
  })
})
