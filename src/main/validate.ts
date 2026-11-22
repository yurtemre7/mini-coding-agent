import { isSessionId } from '../core/session'
import { PROVIDER_IDS } from '../core/provider/factory'
import { EFFORT_LEVELS, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type Attachment, type Decision, type Effort, type IpcContract, type ProviderId } from '../shared/types'

const bad = (m: string): never => {
  throw new Error(`Invalid request: ${m}`)
}
const str = (v: unknown, name: string): string => (typeof v === 'string' ? v : bad(`${name} must be a string`))
const provider = (v: unknown): ProviderId => (PROVIDER_IDS.includes(v as ProviderId) ? (v as ProviderId) : bad('unknown provider'))
const bool = (v: unknown, name: string): boolean => (typeof v === 'boolean' ? v : bad(`${name} must be a boolean`))
const effort = (v: unknown): Effort => (EFFORT_LEVELS.includes(v as Effort) ? (v as Effort) : bad('unknown effort'))
const scope = (v: unknown): 'turn' | 'all' => (v === 'turn' || v === 'all' ? v : bad('scope must be "turn" or "all"'))
const changedPath = (v: unknown): string => {
  const p = str(v, 'path')
  return p.length > 0 && p.length <= 4096 && !p.includes('\0') ? p : bad('invalid path')
}
const obj = (v: unknown, name: string): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(`${name} must be an object`))

const attachments = (v: unknown): Attachment[] => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_ATTACHMENTS) return bad(`at most ${MAX_ATTACHMENTS} attachments`)
  return v.map((a) => {
    const o = obj(a, 'attachment')
    const data = str(o.data, 'attachment.data')
    if (data.length > MAX_ATTACHMENT_BYTES * 1.4) bad('attachment too large')
    return { name: str(o.name, 'attachment.name').slice(0, 200), mime: str(o.mime, 'attachment.mime'), data }
  })
}

/** Every invoke channel's arguments are checked in main, whatever the renderer sends. Returns the sanitized tuple. */
export const validators: { [K in keyof IpcContract['invoke']]: (args: unknown[]) => IpcContract['invoke'][K]['args'] } = {
  'app:getInfo': () => [],
  'session:send': ([t, a]) => [str(t, 'text'), attachments(a)],
  'session:abort': () => [],
  'session:getState': () => [],
  'session:command': ([l]) => [str(l, 'command')],
  'changes:diff': ([s, p]) => [scope(s), changedPath(p)],
  'changes:revert': ([s, p]) => [scope(s), changedPath(p)],
  'commands:list': () => [],
  'workspace:select': () => [],
  'workspace:recent': () => [],
  'workspace:open': ([p]) => [str(p, 'path')], // the controller only accepts paths from the recent list
  'workspace:forget': ([p]) => [str(p, 'path')],
  'workspace:reorder': ([o]) => [Array.isArray(o) && o.length <= 100 ? o.map((p) => changedPath(p)) : bad('order must be a list of at most 100 paths')],
  'workspace:overview': () => [],
  'session:list': () => [],
  'session:open': ([id]) => [isSessionId(id) ? id : bad('invalid session id')],
  'session:new': () => [],
  'session:delete': ([id]) => [isSessionId(id) ? id : bad('invalid session id')],
  'session:export': ([id]) => [isSessionId(id) ? id : bad('invalid session id')],
  'workspace:reveal': () => [],
  'workspace:files': () => [],
  'git:status': () => [],
  'git:diff': ([p, s]) => [str(p, 'path'), bool(s, 'staged')],
  'git:stage': ([ps, s]) => [Array.isArray(ps) && ps.length <= 500 ? ps.map((p) => str(p, 'path')) : bad('paths must be an array'), bool(s, 'stage')],
  'git:commit': ([m]) => [str(m, 'message').slice(0, 10_000)],
  'git:push': () => [],
  'git:branches': () => [],
  'git:switch': ([n, c]) => [str(n, 'name').slice(0, 250), bool(c, 'create')],
  'terminal:run': ([c]) => [str(c, 'command').slice(0, 10_000)],
  'terminal:kill': () => [],
  'settings:get': () => [],
  'settings:setKey': ([p, k]) => [provider(p), str(k, 'key')],
  'settings:update': ([patch]) => {
    const o = obj(patch, 'patch')
    return [{ ...(o.provider !== undefined && { provider: provider(o.provider) }), ...(o.model !== undefined && { model: str(o.model, 'model') }), ...(o.effort !== undefined && { effort: effort(o.effort) }), ...(o.notifications !== undefined && { notifications: bool(o.notifications, 'notifications') }), ...(o.systemPrompt !== undefined && { systemPrompt: str(o.systemPrompt, 'systemPrompt') }), ...(o.systemReplace !== undefined && { systemReplace: bool(o.systemReplace, 'systemReplace') }) }]
  },
  'settings:models': ([p]) => [provider(p)],
  'prompt:answer': ([id, d]) => {
    const o = obj(d, 'decision')
    if (typeof o.allow !== 'boolean') bad('decision.allow must be a boolean')
    if (o.scope !== undefined && o.scope !== 'once' && o.scope !== 'session') bad('decision.scope must be "once" or "session"')
    if (o.feedback !== undefined && typeof o.feedback !== 'string') bad('decision.feedback must be a string')
    return [str(id, 'id'), { allow: o.allow as boolean, ...(o.scope !== undefined && { scope: o.scope as Decision['scope'] }), ...(o.feedback !== undefined && { feedback: o.feedback as string }) }]
  }
}
