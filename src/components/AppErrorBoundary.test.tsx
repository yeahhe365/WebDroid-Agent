// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function ThrowingChild(): never {
  throw new Error('kaboom')
}

function stubStorage(
  read: (key: string) => string | null = () => null,
): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(read),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  })
}

function setBrowserLanguage(language: string) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language, languages: [language] },
  })
}

function renderCrash() {
  // React logs the caught error; the assertion is about what the user sees.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <AppErrorBoundary>
      <ThrowingChild />
    </AppErrorBoundary>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setBrowserLanguage('en-US')
  stubStorage()
})

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
    renderCrash()

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/kaboom/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reload/i })).toBeTruthy()
  })

  it('speaks the stored language instead of hardcoding one of them', () => {
    stubStorage((key) =>
      key === 'webdroid-agent-settings' ? JSON.stringify({ languageMode: 'zh-CN' }) : null,
    )
    renderCrash()

    expect(screen.getByText('应用启动时出错了，刷新页面通常可以恢复。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
    // The English line used to sit next to the Chinese one; only one may show.
    expect(screen.queryByText(/Something went wrong while starting the app/)).toBeNull()
  })

  it('still renders when storage itself is what throws', () => {
    // Storage access failing is one of the crashes this boundary catches, so
    // reading the language must not throw a second time.
    stubStorage(() => {
      throw new Error('storage disabled')
    })
    setBrowserLanguage('zh-CN')

    renderCrash()

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
  })
})
