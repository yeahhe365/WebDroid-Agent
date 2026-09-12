// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function ThrowingChild(): never {
  throw new Error('kaboom')
}

describe('AppErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <span>all good</span>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('renders a reloadable fallback instead of a blank page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <AppErrorBoundary>
          <ThrowingChild />
        </AppErrorBoundary>,
      )

      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText(/kaboom/)).toBeTruthy()
      expect(screen.getByRole('button', { name: /Reload/i })).toBeTruthy()
    } finally {
      consoleError.mockRestore()
    }
  })
})
