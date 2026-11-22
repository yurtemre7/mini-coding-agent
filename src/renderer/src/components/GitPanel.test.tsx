import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitStatus, McaApi } from '../../../shared/types'
import { GitPanel } from './GitPanel'

const status: GitStatus = { repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, files: [{ path: 'a.ts', index: 'M', worktree: '' }, { path: 'b.ts', index: '', worktree: 'M' }, { path: 'c.ts', index: '', worktree: '?' }] }
const mk = (over: Record<string, unknown> = {}) => {
  const invoke = vi.fn(async (ch: string) => (ch in over ? (over[ch] as () => unknown) : ({ 'git:status': status, 'git:branches': { current: 'main', branches: ['main', 'dev'] }, 'git:diff': '@@\n-old\n+new', 'git:commit': 'abc1234', 'git:push': 'Pushed.' } as Record<string, unknown>)[ch]))
  return { api: { invoke, on: () => () => {} } as unknown as McaApi, invoke }
}

describe('GitPanel', () => {
  it('lists staged and unstaged files and shows a colored diff', async () => {
    const { api, invoke } = mk()
    render(<GitPanel api={api} workspace="/w" busy={false} refreshKey={0} />)
    expect(await screen.findByText('Staged (1)')).toBeInTheDocument()
    expect(screen.getByText('Changes (2)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('b.ts'))
    expect(await screen.findByText('+new')).toHaveClass('text-green-600')
    expect(invoke).toHaveBeenCalledWith('git:diff', 'b.ts', false)
  })
  it('stages, unstages and stages everything', async () => {
    const { api, invoke } = mk()
    render(<GitPanel api={api} workspace="/w" busy={false} refreshKey={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unstage a.ts' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:stage', ['a.ts'], false))
    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:stage', ['b.ts', 'c.ts'], true))
  })
  it('commits with a message, pushes, switches and creates branches; errors are shown', async () => {
    const { api, invoke } = mk()
    render(<GitPanel api={api} workspace="/w" busy={false} refreshKey={0} />)
    const commit = await screen.findByRole('button', { name: 'Commit' })
    expect(commit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'fix it' } })
    fireEvent.click(commit)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:commit', 'fix it'))
    expect(await screen.findByText('Committed abc1234')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:push'))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'dev' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:switch', 'dev', false))
    fireEvent.change(screen.getByLabelText('New branch name'), { target: { value: 'feat/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:switch', 'feat/x', true))
  })
  it('explains a non-repo, a missing workspace and disables actions while the agent works', async () => {
    const none = mk({ 'git:status': { ...status, repo: false } })
    const { rerender } = render(<GitPanel api={none.api} workspace="/w" busy={false} refreshKey={0} />)
    expect(await screen.findByText(/not a git repository/)).toBeInTheDocument()
    rerender(<GitPanel api={none.api} workspace={null} busy={false} refreshKey={0} />)
    expect(screen.getByText(/Open a workspace/)).toBeInTheDocument()
    const { api } = mk()
    render(<GitPanel api={api} workspace="/w" busy refreshKey={0} />)
    expect((await screen.findAllByRole('button', { name: 'Commit' }))[0]).toBeDisabled()
  })
})
