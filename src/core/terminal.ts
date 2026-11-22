import { spawn, type ChildProcess } from 'node:child_process'
import type { TerminalEvent } from '../shared/types'


const MAX_OUTPUT = 1_000_000 // characters streamed per command; the rest is dropped with a note

/**
 * A command runner for the desktop's terminal panel: one command at a time in the workspace, output streamed as it arrives.
 * Not a pty: no interactive programs (vim, ssh prompts), colors are not interpreted. It is the user's own shell, so agent permission rules do not apply.
 */
export class Terminal {
  private child?: ChildProcess
  constructor(private cwd: string, private emit: (e: TerminalEvent) => void, private shell = process.env.SHELL || '/bin/bash') {}

  get running(): boolean {
    return !!this.child
  }

  run(command: string): void {
    const cmd = command.trim()
    if (!cmd) return
    if (this.child) throw new Error('A command is already running. Stop it first.')
    this.emit({ type: 'start', command: cmd })
    let sent = 0
    let dropped = false
    const push = (b: Buffer) => {
      if (sent >= MAX_OUTPUT) {
        if (!dropped) this.emit({ type: 'out', text: '\n… output truncated\n' })
        dropped = true
        return
      }
      const text = b.toString('utf8').slice(0, MAX_OUTPUT - sent)
      sent += text.length
      this.emit({ type: 'out', text })
    }
    // login shell so a GUI-launched app sees the user's PATH; own process group so Stop reaches child processes too
    const child = spawn(this.shell, ['-lc', cmd], { cwd: this.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', GIT_PAGER: 'cat', PAGER: 'cat' } })
    this.child = child
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)
    let done = false
    const finish = (code: number | null, signal: string | null) => {
      if (done) return
      done = true
      if (this.child === child) this.child = undefined
      this.emit({ type: 'exit', code, signal })
    }
    child.on('error', (e) => {
      this.emit({ type: 'out', text: `${e.message}\n` })
      finish(null, null)
    })
    child.on('close', finish)
  }

  /** Stops the running command (its whole process group). */
  kill(): void {
    const pid = this.child?.pid
    if (!pid) return
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      this.child?.kill('SIGTERM')
    }
  }
}
