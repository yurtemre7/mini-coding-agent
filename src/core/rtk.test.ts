import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetRtk, rtkRewrite } from './rtk'

/** A fake `rtk` on a throwaway PATH: `rewrite` prints `rtk <cmd>` and exits with $FAKE_CODE. */
function fake(script: string) {
  const bin = mkdtempSync(join(tmpdir(), 'mca-rtk-'))
  writeFileSync(join(bin, 'rtk'), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, 'rtk'), 0o755)
  return { cwd: bin, env: { PATH: `${bin}:/usr/bin:/bin` } as NodeJS.ProcessEnv }
}

describe('rtkRewrite', () => {
  beforeEach(resetRtk)
  it('uses the rewrite for exit 0 and exit 3', async () => {
    for (const code of [0, 3]) {
      const o = fake(`[ "$1" = rewrite ] && echo "rtk $2" && exit ${code}`)
      expect(await rtkRewrite('git status', o)).toBe('rtk git status')
    }
  })
  it('keeps the original for no equivalent (1), deny (2), a crash, empty output or an unrelated rtk', async () => {
    for (const script of ['exit 1', 'echo "rtk x"; exit 2', 'echo "rtk x"; exit 7', 'exit 0', 'echo "not a rtk command" >&2; exit 2']) {
      resetRtk()
      expect(await rtkRewrite('ls', fake(script))).toBe('ls')
    }
  })
  it('keeps the original when rtk is not installed, and MCA_RTK=0 switches it off', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mca-nortk-'))
    expect(await rtkRewrite('ls', { cwd: empty, env: { PATH: empty } })).toBe('ls')
    const o = fake('echo "rtk $2"')
    resetRtk()
    expect(await rtkRewrite('ls', { ...o, env: { ...o.env, MCA_RTK: '0' } })).toBe('ls')
  })
})
