import { describe, expect, it } from 'vitest'
import { exportMarkdown } from './export'

describe('exportMarkdown', () => {
  it('renders turns, tools and skips injected reminders', () => {
    const md = exportMarkdown('Fix bug', [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>secret ctx</system-reminder>' }, { type: 'text', text: 'Please fix it' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'On it' }, { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'a.txt', is_error: true }] }
    ])
    expect(md).toContain('# Fix bug')
    expect(md).toContain('## You\n\nPlease fix it')
    expect(md).not.toContain('secret ctx')
    expect(md).toContain('**Tool: Bash**')
    expect(md).toContain('_Result (error):_')
  })
  it('uses longer fences when output contains backticks, and clips huge results', () => {
    const md = exportMarkdown('', [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: '```x```' + 'y'.repeat(3000) }] }])
    expect(md).toContain('# Chat')
    expect(md).toContain('````')
    expect(md).toContain('more characters')
  })
})
