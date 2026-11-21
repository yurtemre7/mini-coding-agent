import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Absolute, `~`-expanded path. Relative inputs resolve against the session cwd. */
export const resolvePath = (cwd: string, p: string): string => resolve(cwd, p.replace(/^~(?=$|\/)/, homedir()))

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder, so a symlinked parent cannot hide an escape. */
export function realpathNearest(p: string): string {
  const rest: string[] = []
  let cur = resolve(p)
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...rest) // native: on-disk case on macOS
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return resolve(p)
      rest.unshift(basename(cur))
      cur = parent
    }
  }
}

// folding only ever makes checks stricter, so it is used for protection but never for the workspace check
const fold = (s: string): string => (process.platform === 'darwin' ? s.toLowerCase() : s)

export function isInsideWorkspace(workspace: string, p: string): boolean {
  const rel = relative(realpathNearest(workspace), realpathNearest(p))
  return rel !== '..' && !rel.startsWith('..' + sep)
}

/** Files that could grant the agent permissions or run code: always prompt for writes (except bypassPermissions). */
export function isProtectedPath(p: string): boolean {
  const real = fold(realpathNearest(p))
  const parts = real.split(sep)
  const name = parts.at(-1) ?? ''
  const parent = parts.at(-2)
  if (parts.includes('.git')) return true
  if (name === '.mcp.json') return true
  if ((parent === '.mca' || parent === '.claude') && /^settings.*\.json$/.test(name)) return true
  const mca = join(fold(realpathNearest(homedir())), '.mca')
  return real === mca || real.startsWith(mca + sep)
}
