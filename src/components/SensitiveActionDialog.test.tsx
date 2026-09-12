// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_COPY } from '../lib/appCopy'
import { SensitiveActionDialog } from './SensitiveActionDialog'

const sensitiveActionDialogCss = readFileSync('src/styles/sensitive-action-dialog.css', 'utf8')

afterEach(() => {
  cleanup()
})

describe('SensitiveActionDialog', () => {
  it('renders an in-page confirmation for sensitive actions', () => {
    render(
      <SensitiveActionDialog
        copy={APP_COPY['en-US']}
        request={{
          action: { action: 'tap', x: 100, y: 200 },
          message:
            'Safety policy requires confirmation before authorization, permission, or account-setting changes.',
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Sensitive action requested' })).toBeTruthy()
    expect(screen.getByText(/Safety policy requires confirmation/)).toBeTruthy()
    expect(screen.getByText('tap (100, 200)')).toBeTruthy()
  })

  it('resolves through confirm, cancel, and Escape controls', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(
      <SensitiveActionDialog
        copy={APP_COPY['en-US']}
        request={{
          action: { action: 'back' },
          message: 'Confirm this navigation action.',
        }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('traps Tab focus inside the dialog', () => {
    render(
      <SensitiveActionDialog
        copy={APP_COPY['en-US']}
        request={{
          action: { action: 'tap', x: 10, y: 20 },
          message: 'Confirm this sensitive action.',
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    const executeButton = screen.getByRole('button', { name: 'Execute' })
    expect(document.activeElement).toBe(executeButton)

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(cancelButton)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(executeButton)
  })

  it('keeps long sensitive confirmations scrollable with reachable actions', () => {
    expect(sensitiveActionDialogCss).toMatch(
      /\.sensitive-action-dialog-panel\s*\{[\s\S]*max-height:\s*min\(calc\(100dvh - 48px\),\s*600px\)/,
    )
    expect(sensitiveActionDialogCss).toMatch(
      /\.sensitive-action-dialog-panel\s*\{[\s\S]*overflow-y:\s*auto/,
    )
    expect(sensitiveActionDialogCss).toMatch(
      /\.sensitive-action-dialog-actions\s*\{[\s\S]*position:\s*sticky/,
    )
  })
})
