import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { resolvePath } from '../paths'
import type { Tool, ToolContext } from '../tool'

const MAX_UNPAGED_BYTES = 256 * 1024
const DEFAULT_LIMIT = 2000
const MAX_LINE = 2000

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
    // The whole file is read even for a small window: the freshness hash covers all of it. Multi-MB files cost memory here.
    const text = await readFile(p, 'utf8')
    ctx.files.markRead(p, text, info.mtimeMs) // a partial read counts as a read
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

const stamp = async (p: string, content: string, ctx: ToolContext): Promise<void> => ctx.files.markRead(p, content, (await stat(p)).mtimeMs)

const writeSchema = z.object({
  file_path: z.string().describe('Absolute path, or relative to the working directory'),
  content: z.string().describe('The full new content of the file')
})

export const Write: Tool<z.infer<typeof writeSchema>> = {
  name: 'Write',
  description:
    'Create a file or overwrite it with the given content; parent directories are created. ' +
    'Overwriting an existing file requires reading it first with Read. Prefer Edit for changes to existing files.',
  schema: writeSchema,
  readOnly: false,
  async run({ file_path, content }, ctx) {
    const p = resolvePath(ctx.cwd, file_path)
    const info = await stat(p).catch(() => undefined)
    if (info?.isDirectory()) throw new Error(`${p} is a directory, not a file.`)
    if (info) await ctx.files.assertFresh(p, 'overwrite')
    await ctx.files.record(p)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content)
    await stamp(p, content, ctx)
    return `${info ? 'Overwrote' : 'Created'} ${p}`
  }
}

const editSchema = z.object({
  file_path: z.string().describe('Absolute path, or relative to the working directory'),
  old_string: z.string().describe('Exact text to replace; must be unique in the file unless replace_all is set'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z.boolean().optional().describe('Replace every occurrence')
})

export const Edit: Tool<z.infer<typeof editSchema>> = {
  name: 'Edit',
  description:
    'Replace exact text in a file. The file must have been read with Read first. old_string must match exactly (including whitespace) and be unique, ' +
    'or set replace_all. Do not include the line-number prefixes shown by Read.',
  schema: editSchema,
  readOnly: false,
  async run({ file_path, old_string, new_string, replace_all }, ctx) {
    if (old_string === new_string) throw new Error('old_string and new_string are identical; there is nothing to change.')
    if (old_string === '') throw new Error('old_string is empty. To create or fully replace a file, use Write.')
    const p = resolvePath(ctx.cwd, file_path)
    const info = await stat(p).catch(() => undefined)
    if (!info) throw new Error(`File not found: ${p}`)
    if (info.isDirectory()) throw new Error(`${p} is a directory, not a file.`)
    await ctx.files.assertFresh(p, 'edit')
    const text = await readFile(p, 'utf8')
    let [from, to] = [old_string, new_string]
    // the model writes LF; a CRLF file only matches after converting, and the replacement keeps the file's line endings
    if (!text.includes(from) && text.includes('\r\n') && !from.includes('\r')) [from, to] = [from.replace(/\n/g, '\r\n'), to.replace(/\n/g, '\r\n')]
    const parts = text.split(from)
    const count = parts.length - 1
    if (count === 0) throw new Error(`old_string was not found in ${p}. It must match exactly, including whitespace and indentation; Read the file again and copy the text.`)
    if (count > 1 && !replace_all) throw new Error(`old_string matches ${count} places in ${p}. Add surrounding context to make it unique, or set replace_all.`)
    // split/join (not String.replace) so `$&` and `$1` in the replacement stay literal
    const next = replace_all ? parts.join(to) : parts[0] + to + parts.slice(1).join(from)
    await ctx.files.record(p)
    await writeFile(p, next)
    await stamp(p, next, ctx)
    return `Edited ${p} (${replace_all ? count : 1} replacement${replace_all && count > 1 ? 's' : ''}).`
  }
}
