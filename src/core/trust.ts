import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realpathNearest } from './paths'

const stateFile = (home = homedir()) => join(home, '.mca', 'state.json')

async function read(home?: string): Promise<{ trusted: string[] } & Record<string, unknown>> {
  try {
    const s = JSON.parse(await readFile(stateFile(home), 'utf8'))
    return { ...s, trusted: Array.isArray(s.trusted) ? s.trusted : [] }
  } catch {
    return { trusted: [] }
  }
}

export async function isTrusted(workspace: string, home?: string): Promise<boolean> {
  return (await read(home)).trusted.includes(realpathNearest(workspace))
}

export async function trustWorkspace(workspace: string, home?: string): Promise<void> {
  const s = await read(home)
  const ws = realpathNearest(workspace)
  if (s.trusted.includes(ws)) return
  s.trusted.push(ws)
  await mkdir(join(home ?? homedir(), '.mca'), { recursive: true })
  await writeFile(stateFile(home), JSON.stringify(s, null, 2) + '\n')
}
