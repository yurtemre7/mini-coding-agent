import { PROVIDER_IDS } from '../core/provider/factory'
import type { Decision, IpcContract, ProviderId } from '../shared/types'

const bad = (m: string): never => {
  throw new Error(`Invalid request: ${m}`)
}
const str = (v: unknown, name: string): string => (typeof v === 'string' ? v : bad(`${name} must be a string`))
const provider = (v: unknown): ProviderId => (PROVIDER_IDS.includes(v as ProviderId) ? (v as ProviderId) : bad('unknown provider'))
const obj = (v: unknown, name: string): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(`${name} must be an object`))

/** Every invoke channel's arguments are checked in main, whatever the renderer sends. Returns the sanitized tuple. */
export const validators: { [K in keyof IpcContract['invoke']]: (args: unknown[]) => IpcContract['invoke'][K]['args'] } = {
  'app:getInfo': () => [],
  'session:send': ([t]) => [str(t, 'text')],
  'session:abort': () => [],
  'session:getState': () => [],
  'session:command': ([l]) => [str(l, 'command')],
  'workspace:select': () => [],
  'settings:get': () => [],
  'settings:setKey': ([p, k]) => [provider(p), str(k, 'key')],
  'settings:update': ([patch]) => {
    const o = obj(patch, 'patch')
    return [{ ...(o.provider !== undefined && { provider: provider(o.provider) }), ...(o.model !== undefined && { model: str(o.model, 'model') }) }]
  },
  'prompt:answer': ([id, d]) => {
    const o = obj(d, 'decision')
    if (typeof o.allow !== 'boolean') bad('decision.allow must be a boolean')
    if (o.scope !== undefined && o.scope !== 'once' && o.scope !== 'session') bad('decision.scope must be "once" or "session"')
    if (o.feedback !== undefined && typeof o.feedback !== 'string') bad('decision.feedback must be a string')
    return [str(id, 'id'), { allow: o.allow as boolean, ...(o.scope !== undefined && { scope: o.scope as Decision['scope'] }), ...(o.feedback !== undefined && { feedback: o.feedback as string }) }]
  }
}
