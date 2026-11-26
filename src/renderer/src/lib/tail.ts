export const BASH_PREVIEW_LINES = 4

/** The last `n` output lines (trailing whitespace trimmed) plus how many earlier lines were left out. */
export function tailLines(text: string, n = BASH_PREVIEW_LINES): { lines: string[]; hidden: number } {
  const all = text.replace(/\s+$/, '').split('\n')
  if (all.length === 1 && all[0] === '') return { lines: [], hidden: 0 }
  return { lines: all.slice(-n), hidden: Math.max(0, all.length - n) }
}
