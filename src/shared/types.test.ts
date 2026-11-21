import { describe, expect, it } from 'vitest'
import { parseEffort } from './types'

describe('parseEffort (--effort)', () => {
  it('defaults to medium, accepts the levels, rejects anything else', () => {
    expect(parseEffort(undefined)).toBe('medium')
    expect(parseEffort('xhigh')).toBe('xhigh')
    expect(parseEffort('turbo')).toBeUndefined()
  })
})
