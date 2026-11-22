/** Anthropic list prices in USD per million tokens (first-party API; checked 2026-11). Estimates only: a bill can differ (tiers, discounts, fast mode). */
interface Price {
  input: number
  output: number
  /** Defaults to 0.1 x input. */
  cacheRead?: number
  /** 5-minute cache writes; defaults to 1.25 x input. */
  cacheWrite?: number
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-mythos-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-mythos-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }, // prompts above 100K tokens cost more; not modelled
  'claude-haiku-4-5': { input: 1, output: 5 }
}

/** `anthropic/claude-sonnet-5.5` (OpenRouter) and `claude-sonnet-5-5` name the same model. */
const normalize = (model: string): string => model.replace(/^anthropic\//, '').replace(/\./g, '-')

export interface TokenUsage {
  /** Uncached input tokens. */
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** Estimated cost of one request in USD, or undefined when the model has no known price. */
export function estimateCostUsd(model: string, u: TokenUsage): number | undefined {
  const p = PRICES[normalize(model)]
  if (!p) return undefined
  const perToken = (usdPerMillion: number): number => usdPerMillion / 1_000_000
  return u.input * perToken(p.input) + u.cacheRead * perToken(p.cacheRead ?? p.input * 0.1) + u.cacheWrite * perToken(p.cacheWrite ?? p.input * 1.25) + u.output * perToken(p.output)
}
