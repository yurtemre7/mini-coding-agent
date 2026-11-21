import { ENV_VARS, getKey, type ProviderId } from '../credentials'
import { AnthropicProvider } from './anthropic'
import { OpenRouterProvider } from './openrouter'
import type { ModelProvider } from './types'

export class MissingKeyError extends Error {
  constructor(provider: ProviderId) {
    super(`No API key for ${provider}. Set ${ENV_VARS[provider]} or save a key in MCA Settings.`)
  }
}

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openrouter']

export function createProvider(id: ProviderId, apiKey: string): ModelProvider {
  return id === 'anthropic' ? new AnthropicProvider(apiKey) : new OpenRouterProvider(apiKey)
}

export async function providerFromCredentials(id: ProviderId): Promise<ModelProvider> {
  const key = await getKey(id)
  if (!key) throw new MissingKeyError(id)
  return createProvider(id, key)
}
