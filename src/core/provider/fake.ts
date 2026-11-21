import type { ModelInfo, ModelProvider, StreamEvent, StreamRequest } from './types'

type Turn = StreamEvent[] | ((req: StreamRequest) => StreamEvent[] | AsyncIterable<StreamEvent>)

/** Scripted provider: each stream() call plays the next turn. Records requests (deep-copied). */
export class FakeProvider implements ModelProvider {
  readonly id = 'fake' as const
  requests: StreamRequest[] = []
  constructor(
    private turns: Turn[],
    private window = 200_000
  ) {}

  async contextWindow(): Promise<number> {
    return this.window
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    this.requests.push({ ...req, messages: structuredClone(req.messages) })
    const turn = this.turns.shift()
    if (!turn) throw new Error('FakeProvider: script exhausted')
    for await (const ev of typeof turn === 'function' ? turn(req) : turn) {
      if (req.signal.aborted) throw new Error('aborted')
      yield ev
    }
  }
}
