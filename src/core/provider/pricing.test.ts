import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from './pricing'

const tokens = { input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, output: 1_000_000 }

describe('estimateCostUsd', () => {
  it('prices input, cache reads and writes, and output per million tokens', () => {
    // Sonnet 5.5: $2 in, $0.10 cache read, 1.25 x input for cache writes, $10 out
    expect(estimateCostUsd('claude-sonnet-5-5', tokens)).toBeCloseTo(2 + 0.1 + 2.5 + 10, 10)
  })
  it('defaults cache reads to a tenth of the input price when the model lists none', () => {
    expect(estimateCostUsd('claude-sonnet-4-6', { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 })).toBeCloseTo(0.3, 10)
  })
  it('accepts OpenRouter ids (provider prefix, dots in the version)', () => {
    expect(estimateCostUsd('anthropic/claude-sonnet-5.5', tokens)).toBe(estimateCostUsd('claude-sonnet-5-5', tokens))
  })
  it('is undefined for a model without a known price, and zero for no tokens', () => {
    expect(estimateCostUsd('gpt-x', tokens)).toBeUndefined()
    expect(estimateCostUsd('claude-opus-5-5', { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0)
  })
})
