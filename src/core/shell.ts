import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

export interface Shell {
  kind: 'bash' | 'powershell'
  path: string
}

interface Probe {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (p: string) => boolean
}

/**
 * The shell the Bash tool and the terminal panel run commands in. macOS and Linux: /bin/bash. Windows: Git Bash when Git for Windows is installed
 * (so the POSIX permission rules keep applying), otherwise PowerShell (pwsh, then Windows PowerShell). Set MCA_BASH to a bash.exe to choose one.
 * The WSL launcher (System32\bash.exe) is never used: it would run commands inside a Linux VM.
 */
export function findShell(o: Probe = {}): Shell {
  const platform = o.platform ?? process.platform
  if (platform !== 'win32') return { kind: 'bash', path: '/bin/bash' }
  const env = o.env ?? process.env
  const exists = o.exists ?? existsSync
  const get = (k: string): string | undefined => env[k] ?? env[k.toUpperCase()]
  const w = win32
  const bases = [get('ProgramFiles'), get('ProgramW6432'), get('ProgramFiles(x86)'), get('LOCALAPPDATA') && w.join(get('LOCALAPPDATA')!, 'Programs')].filter((b): b is string => !!b)
  const onPath = (name: string): string[] => (get('PATH') ?? '').split(';').filter(Boolean).map((d) => w.join(d, name))
  const git = [...bases.flatMap((b) => [w.join(b, 'Git', 'bin', 'bash.exe'), w.join(b, 'Git', 'usr', 'bin', 'bash.exe')]), ...onPath('bash.exe').filter((p) => !/[\\/]system32[\\/]/i.test(p) && !/[\\/]windowsapps[\\/]/i.test(p))]
  const bash = [env.MCA_BASH, ...git].find((p): p is string => !!p && exists(p))
  if (bash) return { kind: 'bash', path: bash }
  const pwsh = onPath('pwsh.exe').find(exists)
  if (pwsh) return { kind: 'powershell', path: pwsh }
  const root = get('SystemRoot') ?? 'C:\\Windows'
  return { kind: 'powershell', path: w.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') }
}

let cached: Shell | undefined
export const getShell = (): Shell => (cached ??= findShell())
export const setShell = (s: Shell | undefined): void => void (cached = s) // tests

/** The tool description names the shell so the model writes commands for it. */
export const shellName = (s: Shell = getShell()): string => (s.kind === 'bash' ? 'bash' : 'PowerShell')

/** The script PowerShell runs: UTF-8 output, the command, then the final directory is recorded and the exit code kept (a thrown error is exit 1). */
export const powershellScript = (command: string): string =>
  [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'",
    '$global:LASTEXITCODE = 0',
    `try {\n${command}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); $global:LASTEXITCODE = 1 }`,
    '(Get-Location).Path | Set-Content -LiteralPath $env:MCA_CWD_FILE -NoNewline',
    'exit $global:LASTEXITCODE'
  ].join('\n')

/** Program arguments that run `command` once in this shell. `cwdFile` is where the shell records its final directory. */
export function shellArgs(shell: Shell, command: string): string[] {
  if (shell.kind === 'powershell') return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(powershellScript(command), 'utf16le').toString('base64')]
  // an EXIT trap records the final cwd even after `exit N`, and command output cannot forge it; `pwd -W` is the Windows form under Git Bash
  return ['-c', `trap 'pwd -W 2>/dev/null > "$MCA_CWD_FILE" || pwd -P > "$MCA_CWD_FILE"' EXIT; ${command}`]
}

/** A path as the shell's environment variable should hold it: forward slashes work in Git Bash and PowerShell alike. */
export const envPath = (p: string): string => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p)

/** Stops a process and everything it started. POSIX: its process group. Windows: taskkill /T. */
export function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // already gone
  }
}

