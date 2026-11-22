/** Files whose name starts with the query first, then path matches, shortest first; at most 8. */
export function rankFiles(files: string[], query: string): string[] {
  const q = query.toLowerCase()
  const name = (f: string) => f.slice(f.lastIndexOf('/') + 1).toLowerCase()
  const score = (f: string) => (!q ? 2 : name(f).startsWith(q) ? 0 : name(f).includes(q) ? 1 : f.toLowerCase().includes(q) ? 2 : 9)
  return files
    .map((f) => [f, score(f)] as const)
    .filter(([, sc]) => sc < 9)
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length)
    .slice(0, 8)
    .map(([f]) => f)
}
