import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatTranscript, PREVIEW_CHARS } from './ChatTranscript'

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
})
