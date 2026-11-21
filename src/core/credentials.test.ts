import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKey, setKey, type Keychain } from './credentials'

// Every call passes a fake keychain or `undefined` explicitly; the real Keychain is never touched.
const fakeKeychain = (store: Record<string, string> = {}): Keychain => ({
  get: async (p) => store[p] ?? null,
  set: async (p, k) => void (store[p] = k)
})
beforeEach(() => {
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'mca-home-')))
  vi.stubEnv('ANTHROPIC_API_KEY', '')
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
  it('returns null when nothing is set', async () => expect(await getKey('openrouter', fakeKeychain())).toBeNull())
  it('writes the file store with mode 0600', async () => {
    await setKey('openrouter', 'k', { get: async () => null, set: async () => Promise.reject(new Error('no keychain')) })
    expect(statSync(join(process.env.HOME!, '.mca', 'credentials.json')).mode & 0o777).toBe(0o600)
  })
  it('writes through the keychain when it works', async () => {
    const store: Record<string, string> = {}
    await setKey('anthropic', 'kc-key', fakeKeychain(store))
    expect(store.anthropic).toBe('kc-key')
  })
})
