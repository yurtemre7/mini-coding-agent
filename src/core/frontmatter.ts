/** A leading `---` block of `key: value` lines. Anything malformed (no closing line, a line that is not key: value) means "no frontmatter": the whole text is the body. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) return { meta: {}, body: text }
    meta[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return { meta, body: lines.slice(end + 1).join('\n').replace(/^\n/, '') }
}
