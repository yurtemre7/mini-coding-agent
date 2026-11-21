import type { Effort, ProviderId } from '../../../shared/types'

export const PROVIDER_LABELS: Record<ProviderId, string> = { anthropic: 'Anthropic', openrouter: 'OpenRouter' }

export const EFFORT_LABELS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
