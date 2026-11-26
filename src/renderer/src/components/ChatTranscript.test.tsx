import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatTranscript, PREVIEW_CHARS, segments } from './ChatTranscript'

describe('ChatTranscript working indicator', () => {
  afterEach(() => vi.useRealTimers())
  it('is shown only while busy, names the current activity and counts seconds live', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ChatTranscript items={[]} busy={false} />)
    expect(screen.queryByTestId('working')).toBeNull()
    rerender(<ChatTranscript items={[{ kind: 'user', text: 'hi' }]} busy />)
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
    expect(screen.getByRole('status')).toHaveTextContent('0s')
    act(() => void vi.advanceTimersByTime(3000))
    expect(screen.getByRole('status')).toHaveTextContent('3s')
    rerender(<ChatTranscript items={[{ kind: 'user', text: 'hi' }, { kind: 'tool', id: 't', name: 'Bash', input: { command: 'npm test' }, done: false }]} busy />)
    expect(screen.getByRole('status')).toHaveTextContent('Running Bash · npm test')
    rerender(<ChatTranscript items={[{ kind: 'text', text: 'partial' }]} busy />)
    expect(screen.getByRole('status')).toHaveTextContent('Writing…')
    rerender(<ChatTranscript items={[]} busy={false} />)
    expect(screen.queryByTestId('working')).toBeNull()
  })
})

describe('ChatTranscript', () => {
  it('renders GFM but not raw HTML; links open in a new window', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n\n<script id="x">alert(1)</script><b id="raw">hi</b>\n\n[link](https://example.com)'
    const { container } = render(<ChatTranscript items={[{ kind: 'text', text: md }]} />)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('#x, #raw')).toBeNull()
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('target', '_blank')
  })
  it('tool cards start collapsed, bound their preview and nest subagent items', async () => {
    const big = 'x'.repeat(PREVIEW_CHARS + 500)
    const items = [
      { kind: 'tool' as const, id: 't', name: 'Task', input: {}, done: true, result: big },
      { kind: 'text' as const, text: 'from subagent', parentId: 't' }
    ]
    const { container } = render(<ChatTranscript items={items} />)
    expect(screen.queryByText(/from subagent/)).toBeNull() // collapsed
    ;(screen.getByText('Task').closest('button') as HTMLElement).click()
    expect(await screen.findByText(/from subagent/)).toBeInTheDocument()
    expect(container.textContent).toContain('500 more characters')
    expect(container.textContent).not.toContain(big)
  })
  it('folds consecutive tool calls into one row that shows only the names until expanded', async () => {
    const tool = (id: string, name: string, done = true) => ({ kind: 'tool' as const, id, name, input: { command: `cmd-${id}` }, done, result: '' })
    const items = [tool('a', 'Bash'), tool('b', 'Bash'), tool('c', 'Bash', false), { kind: 'text' as const, text: 'between' }, tool('d', 'Read')]
    render(<ChatTranscript items={items} />)
    expect(segments(items)).toHaveLength(3)
    expect(screen.getByText('Bash ×3')).toBeInTheDocument()
    expect(screen.getByLabelText('running')).toBeInTheDocument()
    expect(screen.queryByText('cmd-a')).toBeNull() // collapsed: no subjects
    expect(screen.getByText('Read')).toBeInTheDocument()
    ;(screen.getByText('Bash ×3').closest('button') as HTMLElement).click()
    expect(await screen.findByText('cmd-a')).toBeInTheDocument()
  })
})
