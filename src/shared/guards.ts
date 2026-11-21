import type { Todo } from './types'

/** Helpers for reading unknown JSON (settings files, tool inputs, provider payloads) without `any`. */

export const asRecord = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)

export const field = (v: unknown, key: string): unknown => asRecord(v)?.[key]

export const stringField = (v: unknown, key: string): string | undefined => {
  const x = field(v, key)
  return typeof x === 'string' ? x : undefined
}

const SUBJECT_KEYS = ['command', 'file_path', 'pattern', 'url', 'path'] as const

/** The one value that says what a tool call is about (a command, a file, a pattern, a URL), or '' when the input has none. */
export function toolSubject(input: unknown): string {
  for (const k of SUBJECT_KEYS) {
    const x = field(input, k)
    if (x !== undefined && x !== null) return String(x)
  }
  return typeof input === 'string' ? input : ''
}

export const isTodo = (v: unknown): v is Todo => {
  const status = field(v, 'status')
  return typeof field(v, 'content') === 'string' && (status === 'pending' || status === 'in_progress' || status === 'completed')
}
