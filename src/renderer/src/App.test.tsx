import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    delete window.mca
  })

  it('renders mini-coding-agent (MCA) heading and badge', () => {
    render(<App />)

    expect(screen.getByText('mini-coding-agent')).toBeInTheDocument()
    expect(screen.getByText('MCA')).toBeInTheDocument()
  })

  it('displays app info from Electron IPC when available', async () => {
    window.mca = {
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'mini-coding-agent',
        shortName: 'MCA',
        version: '0.1.0',
        platform: 'darwin',
        electronVersion: '36.3.1'
      })
    }

    render(<App />)

    expect(await screen.findByText('36.3.1')).toBeInTheDocument()
    expect(screen.getByText('darwin')).toBeInTheDocument()
  })

  it('updates status when clicking Start MCA', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /start mca/i }))
    expect(screen.getByText('Status: Agent ready')).toBeInTheDocument()
  })
})
