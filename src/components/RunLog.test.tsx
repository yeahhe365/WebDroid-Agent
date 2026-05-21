// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunLog, type LogEntry } from './RunLog'

afterEach(() => {
  cleanup()
})

describe('RunLog', () => {
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

    expect(screen.getByAltText('Screenshot for Step 1: tap (100, 200)').getAttribute('src')).toBe(
      'data:image/png;base64,abc123',
    )

    fireEvent.click(screen.getByRole('button', { name: /open screenshot/i }))

    expect(screen.getByRole('dialog', { name: /screenshot/i })).toBeTruthy()
    expect(
      screen.getByAltText('Expanded screenshot for Step 1: tap (100, 200)').getAttribute('src'),
    ).toBe('data:image/png;base64,abc123')
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
})
