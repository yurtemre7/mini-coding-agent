import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realpathNearest } from './paths'

const stateFile = (home = homedir()) => join(home, '.mca', 'state.json')

/** Missing file = empty state. A file that exists but is unreadable or corrupt throws, so it is never silently overwritten. */
async function read(home?: string): Promise<{ trusted: string[] } & Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(stateFile(home), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { trusted: [] }
    throw e
  }
  const s = JSON.parse(text)
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('not an object')
  return { ...s, trusted: Array.isArray(s.trusted) ? s.trusted : [] }
}

export async function isTrusted(workspace: string, home?: string): Promise<boolean> {
  return (await read(home).catch(() => ({ trusted: [] as string[] }))).trusted.includes(realpathNearest(workspace))
}

export async function trustWorkspace(workspace: string, home?: string): Promise<void> {
  const s = await read(home).catch((e: Error) => {
    throw new Error(`${stateFile(home)} is corrupt (${e.message}); not recording trust. Fix or delete the file.`)
  })
  const ws = realpathNearest(workspace)
  if (s.trusted.includes(ws)) return
  s.trusted.push(ws)
  await mkdir(join(home ?? homedir(), '.mca'), { recursive: true })
  const tmp = `${stateFile(home)}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2) + '\n')
  await rename(tmp, stateFile(home)) // atomic: a crash never leaves a half-written state.json
}
