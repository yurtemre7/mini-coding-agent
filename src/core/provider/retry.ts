import type { StreamEvent } from './types'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

export const authMessage = (provider: string, envVar: string): string =>
  `Authentication failed for ${provider}. Set ${envVar} or save a key in MCA Settings (Keychain or ~/.mca/credentials.json).`

const MAX_RETRIES = 4
const retryable = (s?: number): boolean => s === 429 || s === 529 || (s !== undefined && s >= 500)
const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true })
  })

/** Retries 429/529/5xx with exponential backoff (or retry-after). Never retries once an event was emitted. */
export async function* withRetry(
  open: () => AsyncIterable<StreamEvent>,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = realSleep
): AsyncGenerator<StreamEvent> {
  for (let attempt = 0; ; attempt++) {
    let emitted = false
    try {
      for await (const ev of open()) {
        emitted = true
        yield ev
      }
      return
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : undefined
      if (emitted || signal.aborted || attempt >= MAX_RETRIES || !retryable(status)) throw e
      await sleep((e as ProviderError).retryAfterMs ?? 1000 * 2 ** attempt, signal)
    }
  }
}
