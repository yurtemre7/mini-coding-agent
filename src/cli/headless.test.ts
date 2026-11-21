import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../core/provider/fake'
import { plainFrontend, runHeadless } from './headless'

const io = () => {
  const o = { out: '', err: '' }
  return { o, io: { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s) } }
}

describe('headless', () => {
  it('answer to stdout, tool activity to stderr, exit 0', async () => {
    const { o, io: i } = io()
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'package.json' } }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'version is 0.1.0' }, { type: 'stop', reason: 'end_turn' }]
    ])
    expect(await runHeadless({ prompt: 'p', provider, model: 'm', cwd: process.cwd(), io: i })).toBe(0)
    expect(o.out).toBe('version is 0.1.0\n')
    expect(o.err).toContain('⏺ Read(')
    expect(o.err).toContain('⎿')
  })

  it('exit 1 on a runtime error, message on stderr', async () => {
    const { o, io: i } = io()
    const provider = new FakeProvider([[]]) // no stop event, then script exhausted on the retry-free second call
    provider.stream = () => (async function* () { throw new Error('down') })()
    expect(await runHeadless({ prompt: 'p', provider, model: 'm', cwd: '/', io: i })).toBe(1)
    expect(o.err).toContain('error: down')
  })

  it('plain frontend ask() denies', async () => {
    expect(await plainFrontend(io().io).ask({ kind: 'plan', plan: 'x' })).toMatchObject({ allow: false })
  })
})
