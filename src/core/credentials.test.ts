import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKey, keySource, setKey, type Keychain } from './credentials'

// Every call passes a fake keychain or `undefined` explicitly; the real Keychain is never touched.
const fakeKeychain = (store: Record<string, string> = {}): Keychain => ({
  get: async (p) => store[p] ?? null,
  set: async (p, k) => void (store[p] = k)
})
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'mca-home-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home) // os.homedir() on Windows
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('OPENROUTER_API_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('credentials', () => {
  it('prefers env, then keychain, then file', async () => {
    const kc = fakeKeychain({ anthropic: 'from-keychain' })
    await setKey('anthropic', 'from-file', { get: async () => null, set: async () => Promise.reject(new Error('no keychain')) })
    expect(await getKey('anthropic', fakeKeychain())).toBe('from-file')
    expect(await getKey('anthropic', kc)).toBe('from-keychain')
    vi.stubEnv('ANTHROPIC_API_KEY', 'from-env')
    expect(await getKey('anthropic', kc)).toBe('from-env')
  })
  it('falls back to .env in the launch directory, below every other source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-dotenv-'))
    writeFileSync(join(dir, '.env'), '# keys\nOPENROUTER_API_KEY="from-dotenv"\nOTHER=x\n')
    expect(await getKey('openrouter', fakeKeychain(), dir)).toBe('from-dotenv')
    expect(process.env.OTHER).toBeUndefined()
    expect(await getKey('openrouter', fakeKeychain({ openrouter: 'from-keychain' }), dir)).toBe('from-keychain')
  })
  it('keySource reports the first source that has a key, in lookup order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-src-'))
    expect(await keySource('anthropic', fakeKeychain(), dir)).toBeNull()
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=d\n')
    expect(await keySource('anthropic', fakeKeychain(), dir)).toBe('dotenv')
    await setKey('anthropic', 'f', { get: async () => null, set: async () => Promise.reject(new Error('x')) })
    expect(await keySource('anthropic', fakeKeychain(), dir)).toBe('file')
    expect(await keySource('anthropic', fakeKeychain({ anthropic: 'k' }), dir)).toBe('keychain')
    vi.stubEnv('ANTHROPIC_API_KEY', 'e')
    expect(await keySource('anthropic', fakeKeychain({ anthropic: 'k' }), dir)).toBe('env')
    expect(await keySource('openrouter', fakeKeychain(), dir)).toBeNull()
  })
  it('returns null when nothing is set', async () => expect(await getKey('openrouter', fakeKeychain(), mkdtempSync(join(tmpdir(), 'mca-empty-')))).toBeNull())
  it('writes the file store with mode 0600', async () => {
    await setKey('openrouter', 'k', { get: async () => null, set: async () => Promise.reject(new Error('no keychain')) })
    const mode = statSync(join(process.env.HOME!, '.mca', 'credentials.json')).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o600) // Windows has no POSIX modes
  })
  it('writes through the keychain when it works', async () => {
    const store: Record<string, string> = {}
    await setKey('anthropic', 'kc-key', fakeKeychain(store))
    expect(store.anthropic).toBe('kc-key')
  })
})
