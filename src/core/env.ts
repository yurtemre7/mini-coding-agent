import { exec } from './exec'

export function parseEnv0(raw: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const entry of raw.split('\0')) {
    const i = entry.indexOf('=')
    if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return env
}

let cached: Promise<NodeJS.ProcessEnv> | undefined

/** Login-shell environment, resolved once. GUI launches get a minimal PATH without Homebrew/nvm. */
export function loginEnv(): Promise<NodeJS.ProcessEnv> {
  cached ??= exec(process.env.SHELL || '/bin/zsh', ['-ilc', 'env -0'], { cwd: process.cwd(), timeoutMs: 3000, maxChars: 1_000_000 })
    .then((r) => (r.code === 0 && !r.timedOut ? { ...process.env, ...parseEnv0(r.stdout) } : process.env))
    .catch(() => process.env)
  return cached
}
