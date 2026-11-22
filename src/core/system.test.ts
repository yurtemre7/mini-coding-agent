import { describe, expect, it } from 'vitest'
import { composeSystem } from './system'

describe('composeSystem', () => {
  it('keeps the base prompt without instructions, appends them, or replaces', () => {
    expect(composeSystem('base')).toBe('base')
    expect(composeSystem('base', { systemPrompt: '  ', systemReplace: true })).toBe('base')
    expect(composeSystem('base', { systemPrompt: ' mine ' })).toBe('base\n\nmine')
    expect(composeSystem('base', { systemPrompt: 'mine', systemReplace: true })).toBe('mine')
  })
})
