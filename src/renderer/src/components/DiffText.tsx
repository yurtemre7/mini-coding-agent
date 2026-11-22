const lineClass = (line: string): string => (line.startsWith('+') && !line.startsWith('+++') ? 'text-success' : line.startsWith('-') && !line.startsWith('---') ? 'text-destructive' : line.startsWith('@@') ? 'text-muted-foreground' : '')

/** A unified diff with added and removed lines colored; long lines wrap inside the box. */
export function DiffText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <pre className={`overflow-auto font-mono text-xs whitespace-pre-wrap break-all ${className}`}>
      {text.trim() ? text.split('\n').map((line, i) => <div key={i} className={lineClass(line)}>{line || ' '}</div>) : <span className="text-muted-foreground">No textual changes.</span>}
    </pre>
  )
}
