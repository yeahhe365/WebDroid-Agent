// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const backendMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  screenshot: vi.fn(),
  getDeviceState: vi.fn(),
  enableAdbKeyboard: vi.fn(),
  execute: vi.fn(),
  setPreferAdbKeyboard: vi.fn(),
  setTimingConfig: vi.fn(),
}))

vi.mock('./adapters/webAdbBackend', () => ({
  WebAdbDeviceBackend: vi.fn(function MockWebAdbDeviceBackend() {
    return backendMock
  }),
  isWebUsbSupported: () => true,
}))

describe('App run log', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      clear: vi.fn(() => {
        values.clear()
      }),
    }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    })

    backendMock.connect.mockResolvedValue({
      serial: 'device-1',
      name: 'Pixel',
    })
    backendMock.screenshot.mockResolvedValue({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc123',
      screen: { width: 1080, height: 2400 },
    })
    backendMock.getDeviceState.mockResolvedValue({
      app: 'Chrome',
      packageName: 'com.android.chrome',
    })
    backendMock.enableAdbKeyboard.mockResolvedValue('enabled')
    backendMock.execute.mockResolvedValue('ok')
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          stargazers_count: 123,
          forks_count: 45,
          open_issues_count: 6,
        }),
      }),
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('clears run log entries from the log section', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByText('Agent context reset')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(screen.queryByText('Agent context reset')).toBeNull()
    expect(screen.getByText('No events yet')).toBeTruthy()
  })

  it('renders advanced optimization controls', () => {
    render(<App />)

    expect(screen.getByLabelText(/stream model responses/i)).toBeTruthy()
    expect(screen.getByLabelText(/action settle/i)).toBeTruthy()
    expect(screen.getByLabelText(/double tap interval/i)).toBeTruthy()
    expect(screen.getByLabelText(/keyboard step/i)).toBeTruthy()
  })

  it('collapses model settings behind the current model name', () => {
    render(<App />)

    expect(screen.getByText('gpt-5.5')).toBeTruthy()
    const detailsToggle = screen.getByText('Model settings')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })

  it('opens an about page with repository stats from the top right', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /about/i }))

    expect(await screen.findByRole('dialog', { name: /about webdroid agent/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /github repository/i }).getAttribute('href')).toBe(
      'https://github.com/yeahhe365/webadb-autoglm',
    )
    expect(await screen.findByText('123')).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
  })

  it('keeps follow-up user messages in a continuous chat transcript', () => {
    render(<App />)

    expect(screen.getByText('Open Settings and show the Wi-Fi page.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/chat message/i), {
      target: { value: 'Now open the Bluetooth page.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    const conversation = screen.getByLabelText('Conversation')
    expect(within(conversation).getByText('Open Settings and show the Wi-Fi page.')).toBeTruthy()
    expect(within(conversation).getByText('Now open the Bluetooth page.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    const emptyConversation = screen.getByLabelText('Conversation')
    expect(within(emptyConversation).queryByText('Open Settings and show the Wi-Fi page.')).toBeNull()
    expect(within(emptyConversation).queryByText('Now open the Bluetooth page.')).toBeNull()
    expect(within(emptyConversation).getByText('No messages yet')).toBeTruthy()
  })

  it('captures and displays a screenshot immediately after connecting', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    expect(await screen.findByAltText('Android screenshot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /open screenshot for android screenshot/i }))

    expect(await screen.findByRole('dialog', { name: /android screenshot/i })).toBeTruthy()
    expect(screen.getByAltText('Expanded screenshot for Android screenshot')).toBeTruthy()
  })

  it('collapses connected device details behind the device name', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /connect/i })[0])

    expect(await screen.findByText('Pixel')).toBeTruthy()
    const detailsToggle = await screen.findByText('Device details')
    const details = detailsToggle.closest('details')

    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
  })
})
