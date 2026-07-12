// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunLog, type LogEntry } from './RunLog'

const screenshotLightboxCss = readFileSync('src/styles/screenshot-lightbox.css', 'utf8')

afterEach(() => {
  cleanup()
})

describe('RunLog', () => {
  it('renders a structured empty state when there are no events', () => {
    render(<RunLog logs={[]} onClear={vi.fn()} />)

    expect(screen.getByText('No events yet')).toBeTruthy()
    expect(document.querySelector('.log-empty-state')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear' }).disabled).toBe(true)
  })

  it('renders saved screenshot thumbnails and opens them enlarged', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'info',
        title: 'Step 1: tap (100, 200)',
        detail: 'model output',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 955, height: 2048 },
        },
      },
    ]

    render(<RunLog logs={logs} onClear={vi.fn()} />)

    const thumbnailSrc =
      screen.getByAltText('Screenshot for Step 1: tap (100, 200)').getAttribute('src') ?? ''
    expect(
      thumbnailSrc === 'data:image/png;base64,abc123' || thumbnailSrc.startsWith('blob:'),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /open screenshot/i }))

    expect(screen.getByRole('dialog', { name: /screenshot/i })).toBeTruthy()
    const expandedSrc =
      screen.getByAltText('Expanded screenshot for Step 1: tap (100, 200)').getAttribute('src') ??
      ''
    expect(
      expandedSrc === 'data:image/png;base64,abc123' || expandedSrc.startsWith('blob:'),
    ).toBe(true)
    expect(screen.getByText('955x2048')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close screenshot/i }))

    expect(screen.queryByRole('dialog', { name: /screenshot/i })).toBeNull()
  })

  it('zooms the expanded screenshot with the mouse wheel', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'info',
        title: 'Step 1: tap (100, 200)',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 955, height: 2048 },
        },
      },
    ]

    render(<RunLog logs={logs} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /open screenshot/i }))

    const expanded = screen.getByAltText('Expanded screenshot for Step 1: tap (100, 200)')

    fireEvent.wheel(expanded, { deltaY: -100 })
    expect(expanded.style.height).toBe('115%')

    fireEvent.wheel(expanded, { deltaY: 100 })
    expect(expanded.style.height).toBe('100%')
  })

  it('zooms and resets the expanded screenshot with visible controls', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'info',
        title: 'Step 1: tap (100, 200)',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 955, height: 2048 },
        },
      },
    ]

    render(<RunLog logs={logs} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /open screenshot/i }))

    const expanded = screen.getByAltText('Expanded screenshot for Step 1: tap (100, 200)')

    expect(screen.getByLabelText('Screenshot zoom controls')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in screenshot' }))
    expect(expanded.style.height).toBe('125%')
    expect(screen.getByText('125%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out screenshot' }))
    expect(expanded.style.height).toBe('100%')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out screenshot' }))
    expect(expanded.style.height).toBe('75%')

    fireEvent.click(screen.getByRole('button', { name: 'Reset screenshot zoom' }))
    expect(expanded.style.height).toBe('100%')
  })

  it('wraps screenshot lightbox controls on very narrow screens', () => {
    expect(screenshotLightboxCss).toContain('@media (max-width: 380px)')
    expect(screenshotLightboxCss).toMatch(
      /\.screenshot-modal-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    )
    expect(screenshotLightboxCss).toMatch(
      /\.screenshot-modal-toolbar\s*\{[\s\S]*justify-content:\s*space-between/,
    )
  })

  it('places screenshot thumbnails in a right-side media area', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'ok',
        title: 'Screen captured',
        detail: '1272x2800\nCurrent app: launcher',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1272, height: 2800 },
        },
      },
    ]

    const { container } = render(<RunLog logs={logs} onClear={vi.fn()} />)
    const entry = container.querySelector('.log-entry.with-screenshot')
    const content = entry?.querySelector('.log-entry-content')
    const body = entry?.querySelector('.log-entry-body')
    const media = entry?.querySelector('.log-entry-media')

    expect(entry).toBeTruthy()
    expect(content).toBeTruthy()
    expect(body).toBeTruthy()
    expect(media).toBeTruthy()
    expect(body?.contains(screen.getByText(/Current app: launcher/))).toBe(true)
    expect(body?.contains(media as Element)).toBe(true)
    expect(media?.contains(screen.getByAltText('Screenshot for Screen captured'))).toBe(true)
  })

  it('renders step timeline metadata in one log entry', () => {
    const logs: LogEntry[] = [
      {
        id: 1,
        time: '10:30:00',
        tone: 'ok',
        title: 'Step 2: tap (100, 200)',
        timeline: {
          step: 2,
          currentApp: 'Chrome',
          packageName: 'com.android.chrome',
          modelOutput: '{"action":"tap","x":100,"y":200}',
          actionPreview: 'tap (100, 200)',
          executionActionPreview: 'tap (100, 200)',
          executionResult: 'input tap 100 200',
        },
        screenshot: {
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 955, height: 2048 },
        },
      },
    ]

    render(<RunLog logs={logs} onClear={vi.fn()} />)

    expect(screen.getByText('Step 2')).toBeTruthy()
    expect(screen.getByText('Chrome')).toBeTruthy()
    expect(screen.getByText('com.android.chrome')).toBeTruthy()
    expect(screen.getByText('Model output')).toBeTruthy()
    expect(screen.getByText('Parsed action')).toBeTruthy()
    expect(screen.getByText('Execution result')).toBeTruthy()
    expect(screen.getByText('input tap 100 200')).toBeTruthy()
  })
})
