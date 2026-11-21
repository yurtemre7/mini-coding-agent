import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { toToolDef, truncate } from './tool'

describe('truncate', () => {
  it('leaves short text alone', () => expect(truncate('abc', 10)).toBe('abc'))
  it('keeps head and tail, cuts the middle', () => {
    const out = truncate('A'.repeat(50) + 'M'.repeat(100) + 'Z'.repeat(50), 100)
    expect(out.startsWith('A'.repeat(50))).toBe(true)
    expect(out.endsWith('Z'.repeat(50))).toBe(true)
    expect(out).toContain('100 characters truncated')
    expect(out).not.toContain('M')
  })
})

describe('toToolDef', () => {
  it('converts zod schemas and passes raw JSON schema through', () => {
    const run = async () => ''
    const z1 = toToolDef({ name: 'a', description: 'd', schema: z.object({ x: z.string() }), readOnly: true, run })
    expect(z1.input_schema).toMatchObject({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] })
    const raw = { type: 'object', properties: {} }
    expect(toToolDef({ name: 'b', description: 'd', schema: raw, readOnly: false, run }).input_schema).toBe(raw)
  })
})
