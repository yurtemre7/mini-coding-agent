import { FileState } from '../filestate'
import type { ToolContext } from '../tool'

/** A ToolContext for calling tools directly in tests. */
export function testCtx(root: string, files = new FileState()): ToolContext {
  const ctx: ToolContext = {
    cwd: root,
    root,
    files,
    setCwd: (d) => void (ctx.cwd = d),
    signal: new AbortController().signal,
    ask: async () => ({ allow: false })
  }
  return ctx
}
