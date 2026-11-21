import { spawn } from 'node:child_process'

export interface ExecOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  maxChars?: number // kept per stream: first half + last half
  merge?: boolean // route stderr into stdout (interleaved)
}
export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
  aborted: boolean
}

/** Keeps the first and last `max/2` characters of a stream without holding the whole stream. */
class Bounded {
  private head = ''
  private tail = ''
  private dropped = 0
  constructor(private half: number) {}
  push(s: string): void {
    if (this.head.length < this.half) {
      const room = this.half - this.head.length
      this.head += s.slice(0, room)
      s = s.slice(room)
    }
    this.tail += s
    if (this.tail.length > this.half) {
      this.dropped += this.tail.length - this.half
      this.tail = this.tail.slice(-this.half)
    }
  }
  toString(): string {
    return this.dropped ? `${this.head}\n... [${this.dropped} characters truncated] ...\n${this.tail}` : this.head + this.tail
  }
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

export function exec(cmd: string, args: string[], o: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve) => {
    const half = Math.floor((o.maxChars ?? 30_000) / 2)
    const out = new Bounded(half)
    const err = o.merge ? out : new Bounded(half)
    // detached: own process group, so killing -pid also reaches npm -> node children
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8').on('data', (d: string) => out.push(d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => err.push(d))
    let timedOut = false
    let aborted = false
    let killTimer: NodeJS.Timeout | undefined
    const kill = () => {
      const signalGroup = (s: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, s)
        } catch {
          // already gone
        }
      }
      signalGroup('SIGTERM')
      killTimer = setTimeout(() => signalGroup('SIGKILL'), 2000)
    }
    const timer = o.timeoutMs ? setTimeout(() => ((timedOut = true), kill()), o.timeoutMs) : undefined
    const onAbort = () => ((aborted = true), kill())
    if (o.signal?.aborted) onAbort()
    else o.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (code: number | null) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      o.signal?.removeEventListener('abort', onAbort)
      // resolve on `exit` + drain, not `close`: a backgrounded child can hold the pipes open forever
      setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        resolve({ stdout: out.toString().replace(ANSI, ''), stderr: o.merge ? '' : err.toString().replace(ANSI, ''), code, timedOut, aborted })
      }, 100)
    }
    child.on('error', (e) => {
      err.push(e.message)
      finish(null)
    })
    child.on('exit', (code) => finish(code))
  })
}
