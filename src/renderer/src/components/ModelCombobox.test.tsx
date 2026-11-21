import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelCombobox } from './ModelCombobox'

beforeAll(() => {
  // jsdom lacks what cmdk and Radix popovers use
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any
  Element.prototype.scrollIntoView ??= () => {}
})

const open = (onSelect = vi.fn(), list = { models: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }, { id: 'gpt-x:free', free: true }] }) => {
  render(<ModelCombobox value="gpt-x" list={list} onSelect={onSelect} />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  return onSelect
}

describe('ModelCombobox', () => {
  it('filters the list as you type', async () => {
    open()
    expect(await screen.findByText('claude-haiku-5-5')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/search or type/i), { target: { value: 'haiku' } })
    expect(screen.getByText('claude-haiku-5-5')).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-5-5')).toBeNull()
  })
  it('tags free models', async () => {
    open()
    expect(await screen.findByText('gpt-x:free')).toBeInTheDocument()
    expect(screen.getAllByText('Free')).toHaveLength(1)
  })
  it('offers the typed text as a custom id and selects it', async () => {
    const onSelect = open()
    fireEvent.change(await screen.findByPlaceholderText(/search or type/i), { target: { value: 'my/custom-model' } })
    fireEvent.click(screen.getByText('Use "my/custom-model"'))
    expect(onSelect).toHaveBeenCalledWith('my/custom-model')
  })
  it('shows loading and the fallback error', async () => {
    open(vi.fn(), { models: [{ id: 'a' }], loading: true, error: 'offline' } as any)
    expect(await screen.findByText('Loading models…')).toBeInTheDocument()
    expect(screen.getByText(/offline/)).toBeInTheDocument()
  })
})
