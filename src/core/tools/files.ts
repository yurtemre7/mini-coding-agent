import { open, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Tool } from '../tool'

const MAX_UNPAGED_BYTES = 256 * 1024
const DEFAULT_LIMIT = 2000
const MAX_LINE = 2000

// shortcut: plain resolve + ~ expansion; workspace/protected-path checks and readState come with paths.ts / filestate.ts (Milestone 2)
export const resolvePath = (cwd: string, p: string): string => resolve(cwd, p.replace(/^~(?=$|\/)/, homedir()))

const schema = z.object({
  file_path: z.string().describe('Absolute path, or relative to the working directory'),
  offset: z.number().int().min(1).optional().describe('1-based line to start from'),
  limit: z.number().int().min(1).optional().describe('Number of lines to read (default 2000)')
})

export const Read: Tool<z.infer<typeof schema>> = {
  name: 'Read',
  description:
    'Read a text file. Output is numbered like `cat -n` (line number, tab, line); the numbers are not part of the file. ' +
    `Reads up to ${DEFAULT_LIMIT} lines by default and truncates lines over ${MAX_LINE} characters. ` +
    'Files over 256 KB need offset/limit; use Grep to find the part you need.',
  schema,
  readOnly: true,
  async run({ file_path, offset, limit }, ctx) {
    const p = resolvePath(ctx.cwd, file_path)
    const info = await stat(p).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') throw new Error(`File not found: ${p}`)
      throw e
    })
    if (info.isDirectory()) throw new Error(`${p} is a directory, not a file. Use Glob to list its files.`)
    if (info.size > MAX_UNPAGED_BYTES && offset === undefined && limit === undefined)
      throw new Error(`${p} is ${Math.round(info.size / 1024)} KB, over the 256 KB limit. Pass offset and limit to read a part, or use Grep to find what you need.`)
    const fh = await open(p, 'r')
    try {
      const head = Buffer.alloc(Math.min(8192, info.size))
      await fh.read(head, 0, head.length, 0)
      if (head.includes(0)) throw new Error(`${p} is a binary file and cannot be read as text.`)
    } finally {
      await fh.close()
    }
    // shortcut: whole file is read into memory even for a small window; stream by line if multi-MB files matter
    const text = await readFile(p, 'utf8')
    if (text === '') return '(file is empty)'
    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const start = offset ?? 1
    if (start > lines.length) return `(offset ${start} is past the end of the file, which has ${lines.length} lines)`
    const end = Math.min(lines.length, start - 1 + (limit ?? DEFAULT_LIMIT))
    const body = lines
      .slice(start - 1, end)
      .map((l, i) => `${String(start + i).padStart(6)}\t${l.length > MAX_LINE ? l.slice(0, MAX_LINE) + '... [line truncated]' : l}`)
      .join('\n')
    return end < lines.length ? `${body}\n\n(${lines.length - end} more lines. Use offset=${end + 1} to continue.)` : body
  }
}
