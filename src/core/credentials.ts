import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

export type ProviderId = 'anthropic' | 'openrouter'
export const ENV_VARS: Record<ProviderId, string> = { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

export interface Keychain {
  get(provider: ProviderId): Promise<string | null>
  set(provider: ProviderId, key: string): Promise<void>
}

const run = promisify(execFile)
const SECURITY = '/usr/bin/security'

export const macKeychain: Keychain = {
  async get(p) {
    try {
      const { stdout } = await run(SECURITY, ['find-generic-password', '-s', 'mca', '-a', p, '-w'])
      return stdout.trim() || null
    } catch {
      return null // exit 44 = item not found; any other failure also falls through to the file store
    }
  },
  async set(p, key) {
    // shortcut: the key is visible in the process list for a few ms; `security -i` stdin would avoid it
    await run(SECURITY, ['add-generic-password', '-U', '-s', 'mca', '-a', p, '-w', key])
  }
}

// Tests and non-macOS: no Keychain (set MCA_NO_KEYCHAIN=1 to force the file store on macOS).
const defaultKeychain = (): Keychain | undefined =>
  process.platform === 'darwin' && !process.env.MCA_NO_KEYCHAIN ? macKeychain : undefined

const file = () => join(homedir(), '.mca', 'credentials.json')

async function readFileStore(): Promise<Partial<Record<ProviderId, string>>> {
  try {
    return JSON.parse(await readFile(file(), 'utf8'))
  } catch {
    return {}
  }
}

/** env -> Keychain -> ~/.mca/credentials.json */
export async function getKey(p: ProviderId, keychain = defaultKeychain()): Promise<string | null> {
  return process.env[ENV_VARS[p]] || (await keychain?.get(p)) || (await readFileStore())[p] || null
}

export async function setKey(p: ProviderId, key: string, keychain = defaultKeychain()): Promise<void> {
  try {
    if (keychain) return await keychain.set(p, key)
  } catch {
    // Keychain unavailable or prompt refused: fall back to the file store
  }
  const store = await readFileStore()
  store[p] = key
  await mkdir(join(homedir(), '.mca'), { recursive: true })
  // temp file + rename: the key is never in a file that is group/world readable
  const tmp = `${file()}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  await rename(tmp, file())
}

export const hasKey = async (p: ProviderId, keychain = defaultKeychain()): Promise<boolean> => !!(await getKey(p, keychain))
