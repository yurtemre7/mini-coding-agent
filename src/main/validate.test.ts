import { describe, expect, it } from 'vitest'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/types'
import { isExternalUrl } from './urls'
import { validators } from './validate'

const v = validators as Record<string, (a: unknown[]) => unknown[]>

describe('IPC validation', () => {
  it('has a validator for every invoke channel, and the preload allowlists match the contract', () => {
    expect(Object.keys(validators).sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect(EVENT_CHANNELS).toEqual(['agent:events', 'prompt:request'])
  })
  it.each([
    ['session:send', [42]],
    ['session:send', []],
    ['session:command', [{}]],
    ['changes:diff', ['week', 'a.ts']],
    ['changes:diff', ['turn', '']],
    ['changes:revert', ['turn', 'a\0b']],
    ['changes:revert', ['all']],
    ['settings:setKey', ['nope', 'k']],
    ['settings:setKey', ['anthropic', 5]],
    ['settings:models', ['evil']],
    ['settings:models', []],
    ['settings:update', ['x']],
    ['settings:update', [{ provider: 'evil' }]],
    ['settings:update', [{ model: 3 }]],
    ['settings:update', [{ effort: 'turbo' }]],
    ['settings:update', [{ notifications: 'yes' }]],
    ['prompt:answer', [1, { allow: true }]],
    ['prompt:answer', ['id', { allow: 'yes' }]],
    ['prompt:answer', ['id', { allow: true, scope: 'forever' }]],
    ['prompt:answer', ['id', { allow: false, feedback: 7 }]],
    ['prompt:answer', ['id', null]],
    ['session:open', ['../x']],
    ['session:open', [5]],
    ['workspace:open', [{}]],
    ['workspace:forget', [5]]
  ])('%s rejects %j', (ch, args) => {
    expect(() => v[ch](args as unknown[])).toThrow(/Invalid request/)
  })
  it('accepts good input and strips unknown fields', () => {
    expect(v['session:send'](['hi'])).toEqual(['hi', []])
    expect(v['settings:setKey'](['openrouter', 'k'])).toEqual(['openrouter', 'k'])
    expect(v['settings:models'](['openrouter', 'x'])).toEqual(['openrouter'])
    expect(v['settings:update']([{ provider: 'anthropic', model: 'm', effort: 'max', extra: 1 }])).toEqual([{ provider: 'anthropic', model: 'm', effort: 'max' }])
    expect(v['prompt:answer'](['id', { allow: true, scope: 'session', feedback: 'f', evil: 1 }])).toEqual(['id', { allow: true, scope: 'session', feedback: 'f' }])
    expect(v['session:abort']([1, 2])).toEqual([])
    expect(v['session:open'](['0b9c-4e1f'])).toEqual(['0b9c-4e1f'])
  })
  it('only http(s) links leave the app', () => {
    expect(isExternalUrl('https://example.com/x')).toBe(true)
    expect(isExternalUrl('http://example.com')).toBe(true)
    for (const u of ['mailto:a@b.c', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x', 'custom://x']) expect(isExternalUrl(u)).toBe(false)
  })
})
