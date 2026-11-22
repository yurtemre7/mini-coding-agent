import { exec } from './exec'

/** null = not known yet; false = no usable `rtk` on PATH (not asked again this run). */
let missing = false

export const resetRtk = (): void => void (missing = false)

/**
 * RTK (rtk-ai/rtk) shortens noisy command output to save tokens. When an `rtk` binary is on PATH, asks `rtk rewrite` for the command's RTK form
 * (`git status` becomes `rtk git status`). Exit 0 and 3 carry a rewrite; anything else (no RTK equivalent, a deny rule, the unrelated crates.io `rtk`,
 * a crash or a hang) runs the original command. Permissions were already checked on the original command; only what is executed changes.
 * Set MCA_RTK=0 to turn it off.
 */
export async function rtkRewrite(command: string, o: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<string> {
  if (missing || o.env.MCA_RTK === '0') return command
  const r = await exec('rtk', ['rewrite', command], { cwd: o.cwd, env: o.env, signal: o.signal, timeoutMs: 3000, maxChars: 20_000 })
  if (r.code === null && !r.timedOut && !r.aborted) {
    missing = true // could not start: rtk is not installed
    return command
  }
  const out = r.stdout.trim()
  return (r.code === 0 || r.code === 3) && out && !out.includes('\0') ? out : command
}
