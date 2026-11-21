export const DEFAULT_MODELS = {
  anthropic: { main: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' },
  openrouter: { main: 'anthropic/claude-sonnet-5.5', fast: 'anthropic/claude-haiku-5.5' }
} as const

export const DEFAULT_CONTEXT_WINDOW = 200_000
export const OPENROUTER_DEFAULT_CONTEXT_WINDOW = 128_000

const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-5-5': 200_000,
  'claude-haiku-5-5': 200_000
}

export const anthropicContextWindow = (model: string): number => CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW
