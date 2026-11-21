import type { Effort } from '../../shared/types'
import type { JsonSchema } from '../tool'

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type Message = { role: 'user' | 'assistant'; content: Block[] }
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error'
export type ToolDef = { name: string; description: string; input_schema: JsonSchema }
export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown } // emitted once, fully parsed
  | { type: 'usage'; contextTokens: number; outputTokens: number } // contextTokens includes cached tokens
  | { type: 'stop'; reason: StopReason }

export interface StreamRequest {
  model: string
  system: string
  messages: Message[]
  tools: ToolDef[]
  maxTokens: number
  effort?: Effort
  signal: AbortSignal
}

import type { ModelInfo } from '../../shared/types'
export type { ModelInfo }

export interface ModelProvider {
  id: 'anthropic' | 'openrouter' | 'fake'
  contextWindow(model: string): Promise<number>
  /** Models this provider offers; throws ProviderError (401/403 = bad key). */
  listModels?(): Promise<ModelInfo[]>
  stream(req: StreamRequest): AsyncIterable<StreamEvent>
}
