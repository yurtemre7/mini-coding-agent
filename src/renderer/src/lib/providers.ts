import type { Effort, ProviderId } from '../../../shared/types'

export const PROVIDER_LABELS: Record<ProviderId, string> = { anthropic: 'Anthropic', openrouter: 'OpenRouter' }

/** Where a person gets a key for each provider, in plain words for the first-run setup. */
export const KEY_HELP: Record<ProviderId, { url: string; steps: string }> = {
  anthropic: { url: 'https://console.anthropic.com/settings/keys', steps: 'Sign in to the Anthropic Console, add billing credit, and create an API key.' },
  openrouter: { url: 'https://openrouter.ai/keys', steps: 'Sign in to OpenRouter, add credit (or pick a free model), and create an API key.' }
}

export const EFFORT_LABELS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
