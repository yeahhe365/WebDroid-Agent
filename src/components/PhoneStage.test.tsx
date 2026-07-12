// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStep } from '../lib/agent'
import { APP_COPY } from '../lib/appCopy'
import { PhoneStage } from './PhoneStage'

const phoneStageCss = readFileSync('src/styles/phone-stage.css', 'utf8')
const responsiveCss = readFileSync('src/styles/responsive.css', 'utf8')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function createPendingStep(overrides: Partial<AgentStep> = {}): AgentStep {
  const action = { action: 'tap', x: 250, y: 500 } as const
  return {
    index: 1,
    screenshot: {
      dataUrl: 'data:image/png;base64,device',
      modelDataUrl: 'data:image/png;base64,model',
      modelScreen: { width: 500, height: 1000 },
      screen: { width: 1000, height: 2000 },
    },
    currentApp: 'Chrome',
    deviceState: { app: 'Chrome' },
    modelOutput: JSON.stringify(action),
    action,
    executionAction: { action: 'tap', x: 500, y: 1000 },
    preview: 'tap (250, 500)',
    timing: {
      captureMs: 1,
      currentAppMs: 1,
      modelMs: 1,
      parseMs: 1,
      totalMs: 4,
    },
    ...overrides,
  }
}

describe('PhoneStage', () => {
  it('keeps a black phone preview visible before a screenshot exists', () => {
    const { container } = render(
      <PhoneStage copy={APP_COPY['en-US']} displayedScreenshot={null} pendingStep={null} />,
    )

    const frame = container.querySelector('.phone-frame')
    const placeholder = container.querySelector('.phone-screen-placeholder')

    expect(screen.getByLabelText('Connect Android device')).toBeTruthy()
    expect(frame).toBeTruthy()
    expect(placeholder).toBeTruthy()
    expect(placeholder?.closest('.phone-frame')).toBe(frame)
    expect(screen.queryByLabelText('Screenshot zoom controls')).toBeNull()
  })

  it('shows a connecting state while the device is connecting', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        pendingStep={null}
        busyTask={{ id: 'connect-device', label: 'Connect device', startedAt: 0 }}
      />,
    )

    const placeholder = document.querySelector('.phone-screen-placeholder') as HTMLElement
    expect(screen.getByLabelText('Connecting…')).toBeTruthy()
    expect(placeholder.getAttribute('aria-busy')).toBe('true')
    expect(placeholder.querySelector('.spin')).toBeTruthy()
    expect(screen.queryByText('Connect and capture to show the live screen here')).toBeNull()
  })

  it('shows a capturing state while the screen is being captured', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        pendingStep={null}
        busyTask={{ id: 'capture-screen', label: 'Capture screen', startedAt: 0 }}
      />,
    )

    expect(screen.getByLabelText('Capturing screen…')).toBeTruthy()
    expect(document.querySelector('.phone-screen-placeholder')?.getAttribute('aria-busy')).toBe('true')
  })

  it('shows a disconnecting state while the device is disconnecting', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        pendingStep={null}
        busyTask={{ id: 'disconnect-device', label: 'Disconnect device', startedAt: 0 }}
      />,
    )

    expect(screen.getByLabelText('Disconnecting…')).toBeTruthy()
  })

  it('shows a connected-waiting state when the device is connected but no screenshot exists', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        pendingStep={null}
        deviceConnected
      />,
    )

    const placeholder = document.querySelector('.phone-screen-placeholder') as HTMLElement
    expect(screen.getByLabelText('Device connected')).toBeTruthy()
    expect(placeholder.getAttribute('aria-busy')).toBeNull()
    expect(placeholder.querySelector('.spin')).toBeNull()
    expect(screen.getByText('Connect and capture to show the live screen here')).toBeTruthy()
  })

  it('keeps the capturing state when a capture-screen busy task is in flight even when the device is connected', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        pendingStep={null}
        busyTask={{ id: 'capture-screen', label: 'Capture screen', startedAt: 0 }}
        deviceConnected
      />,
    )

    expect(screen.getByLabelText('Capturing screen…')).toBeTruthy()
    expect(
      document.querySelector('.phone-screen-placeholder')?.getAttribute('aria-busy'),
    ).toBe('true')
  })

  it('shows the idle placeholder with a hint when no screenshot and no busy task', () => {
    render(
      <PhoneStage copy={APP_COPY['en-US']} displayedScreenshot={null} pendingStep={null} />,
    )

    const placeholder = document.querySelector('.phone-screen-placeholder') as HTMLElement
    expect(screen.getByLabelText('Connect Android device')).toBeTruthy()
    expect(placeholder.getAttribute('aria-busy')).toBeNull()
    expect(placeholder.querySelector('.spin')).toBeNull()
    expect(
      screen.getByText('USB debugging required — authorize on the phone when prompted'),
    ).toBeTruthy()
  })

  it('offers a connect CTA on the idle disconnected phone preview', () => {
    const onConnectDevice = vi.fn()
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={null}
        onConnectDevice={onConnectDevice}
        pendingStep={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(onConnectDevice).toHaveBeenCalledTimes(1)
  })

  it('creates a tap action from a screenshot click', () => {
    const onRunInteractiveAction = vi.fn()
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        onRunInteractiveAction={onRunInteractiveAction}
        pendingStep={null}
      />,
    )

    const layer = screen.getByLabelText('Screenshot interaction layer')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 600,
      left: 10,
      right: 280,
      top: 20,
      width: 270,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(layer, { clientX: 145, clientY: 320 })
    fireEvent.mouseUp(layer, { clientX: 145, clientY: 320 })

    expect(screen.getByText('tap (540, 1200)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run generated action' }))

    expect(onRunInteractiveAction).toHaveBeenCalledWith({ action: 'tap', x: 540, y: 1200 })
  })

  it('clamps manually generated tap coordinates to the valid screen edge', () => {
    const onRunInteractiveAction = vi.fn()
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        onRunInteractiveAction={onRunInteractiveAction}
        pendingStep={null}
      />,
    )

    const layer = screen.getByLabelText('Screenshot interaction layer')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 600,
      left: 10,
      right: 280,
      top: 20,
      width: 270,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(layer, { clientX: 280, clientY: 620 })
    fireEvent.mouseUp(layer, { clientX: 280, clientY: 620 })

    expect(screen.getByText('tap (1079, 2399)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run generated action' }))

    expect(onRunInteractiveAction).toHaveBeenCalledWith({ action: 'tap', x: 1079, y: 2399 })
  })

  it('draws pending action markers from execution coordinates mapped back to the preview', () => {
    const { container } = render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,model',
          screen: { width: 500, height: 1000 },
        }}
        pendingStep={createPendingStep({
          action: { action: 'tap', x: 10, y: 10 },
          executionAction: { action: 'tap', x: 500, y: 1000 },
          preview: 'tap (10, 10)',
        })}
      />,
    )

    const marker = container.querySelector('.tap-marker') as HTMLElement

    expect(marker).toBeTruthy()
    expect(marker.style.left).toBe('50%')
    expect(marker.style.top).toBe('50%')
    expect(marker.getAttribute('title')).toBe('tap (500, 1000)')
  })

  it('does not draw a pending marker on a different displayed screenshot', () => {
    const { container } = render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,new',
          screen: { width: 500, height: 1000 },
        }}
        pendingStep={createPendingStep()}
      />,
    )

    expect(container.querySelector('.tap-marker')).toBeNull()
  })

  it('creates a swipe action from a screenshot drag', () => {
    const onRunInteractiveAction = vi.fn()
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        onRunInteractiveAction={onRunInteractiveAction}
        pendingStep={null}
      />,
    )

    const layer = screen.getByLabelText('Screenshot interaction layer')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 600,
      left: 10,
      right: 280,
      top: 20,
      width: 270,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(layer, { clientX: 145, clientY: 520 })
    fireEvent.mouseUp(layer, { clientX: 145, clientY: 220 })

    expect(screen.getByText('swipe (540, 2000) -> (540, 800)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run generated action' }))

    expect(onRunInteractiveAction).toHaveBeenCalledWith({
      action: 'swipe',
      durationMs: 400,
      fromX: 540,
      fromY: 2000,
      toX: 540,
      toY: 800,
    })
  })

  it('shows a pending swipe path with direction and duration', () => {
    const { container } = render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,model',
          screen: { width: 500, height: 1000 },
        }}
        pendingStep={createPendingStep({
          action: {
            action: 'swipe',
            durationMs: 400,
            fromX: 125,
            fromY: 800,
            toX: 125,
            toY: 200,
          },
          executionAction: {
            action: 'swipe',
            durationMs: 400,
            fromX: 250,
            fromY: 1600,
            toX: 250,
            toY: 400,
          },
          preview: 'swipe (125, 800) -> (125, 200), 400ms',
        })}
      />,
    )

    expect(screen.getByLabelText('Swipe path 400 ms')).toBeTruthy()
    expect(screen.getByText('400 ms')).toBeTruthy()
    expect(container.querySelector('.swipe-path-line')).toBeTruthy()
    expect(container.querySelector('.swipe-path-arrowhead')).toBeTruthy()
  })

  it('sizes the screenshot interaction layer to the visible image, not letterboxed frame', () => {
    class MockResizeObserver {
      private readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe() {
        this.callback(
          [
            {
              contentRect: {
                height: 600,
                width: 270,
              },
            } as ResizeObserverEntry,
          ],
          this as ResizeObserver,
        )
      }

      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const { container } = render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2316 },
        }}
        onRunInteractiveAction={vi.fn()}
        pendingStep={null}
      />,
    )

    const visibleLayer = container.querySelector('.screenshot-visible-layer') as HTMLElement

    expect(visibleLayer.style.left).toBe('0%')
    expect(visibleLayer.style.width).toBe('100%')
    expect(parseFloat(visibleLayer.style.top)).toBeCloseTo(1.75, 2)
    expect(parseFloat(visibleLayer.style.height)).toBeCloseTo(96.5, 1)
  })

  it('zooms and resets the middle screenshot with controls', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        pendingStep={null}
      />,
    )

    const screenshotButton = screen.getByRole('button', {
      name: 'Open screenshot for Android screenshot',
    })
    const zoomSurface = screenshotButton.closest('.phone-zoom-surface') as HTMLElement

    expect(zoomSurface.getAttribute('style')).toContain('width: 100%')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in screenshot' }))

    expect(zoomSurface.getAttribute('style')).toContain('width: 125%')
    expect(screen.getByText('125%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reset screenshot zoom' }))

    expect(zoomSurface.getAttribute('style')).toContain('width: 100%')
  })

  it('places screenshot controls on the preview area instead of inside the phone frame', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        pendingStep={null}
      />,
    )

    const controls = screen.getByLabelText('Screenshot zoom controls')

    expect(controls.closest('.phone-stage')).toBeTruthy()
    expect(controls.closest('.phone-frame')).toBeNull()
  })

  it('reveals screenshot controls only while hovering or focusing the preview area', () => {
    expect(phoneStageCss).toMatch(/\.phone-zoom-controls\s*\{[\s\S]*opacity:\s*0/)
    expect(phoneStageCss).toMatch(/\.phone-zoom-controls\s*\{[\s\S]*pointer-events:\s*none/)
    expect(phoneStageCss).toMatch(
      /\.phone-stage:is\(:hover,\s*:focus-within\)\s+\.phone-zoom-controls\s*\{[\s\S]*opacity:\s*1/,
    )
    expect(phoneStageCss).toMatch(
      /\.phone-stage:is\(:hover,\s*:focus-within\)\s+\.phone-zoom-controls\s*\{[\s\S]*pointer-events:\s*auto/,
    )
  })

  it('sizes the normal phone preview to use most of the preview area', () => {
    expect(phoneStageCss).toMatch(/\.phone-stage\s*\{[\s\S]*padding:\s*var\(--space-6\)/)
    expect(phoneStageCss).toMatch(/\.phone-frame\s*\{[\s\S]*border:\s*6px solid/)
    expect(phoneStageCss).toMatch(/\.phone-frame\s*\{[\s\S]*max-height:\s*min\(82vh,\s*820px\)/)
    expect(phoneStageCss).toMatch(/\.phone-frame\s*\{[\s\S]*width:\s*min\(100%,\s*390px\)/)
    expect(responsiveCss).toMatch(/\.phone-frame\s*\{[\s\S]*max-height:\s*72vh/)
  })

  it('keeps the empty phone preview the same size as the screenshot preview', () => {
    expect(phoneStageCss).not.toMatch(/\.phone-stage-empty\s*\{[\s\S]*min-height/)
    expect(phoneStageCss).not.toMatch(/\.phone-stage-empty\s+\.phone-frame\s*\{/)
    expect(responsiveCss).not.toMatch(/\.phone-stage-empty\s*\{[\s\S]*min-height/)
    expect(responsiveCss).not.toMatch(/\.phone-stage-empty\s+\.phone-frame\s*\{/)
  })

  it('opens the middle phone in fullscreen and exits with Escape', () => {
    render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        pendingStep={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show phone fullscreen' }))

    const fullscreenPhone = screen.getByRole('dialog', { name: 'Fullscreen phone preview' })
    expect(fullscreenPhone.className).toContain('phone-frame-fullscreen')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Fullscreen phone preview' })).toBeNull()
  })

  it('exits fullscreen when the screenshot disappears', () => {
    const { rerender } = render(
      <PhoneStage
        copy={APP_COPY['en-US']}
        displayedScreenshot={{
          dataUrl: 'data:image/png;base64,abc123',
          screen: { width: 1080, height: 2400 },
        }}
        pendingStep={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show phone fullscreen' }))
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<PhoneStage copy={APP_COPY['en-US']} displayedScreenshot={null} pendingStep={null} />)

    expect(screen.queryByRole('dialog', { name: 'Fullscreen phone preview' })).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('styles the fullscreen phone to fill the page', () => {
    expect(phoneStageCss).toMatch(/\.phone-frame-fullscreen\s*\{[\s\S]*inset:\s*0/)
    expect(phoneStageCss).toMatch(/\.phone-frame-fullscreen\s*\{[\s\S]*height:\s*100vh/)
    expect(phoneStageCss).toMatch(/\.phone-frame-fullscreen\s*\{[\s\S]*width:\s*100vw/)
    expect(phoneStageCss).toMatch(/\.phone-frame-fullscreen\s*\{[\s\S]*border-radius:\s*0/)
  })

  it('keeps fullscreen sizing stronger than responsive phone frame caps', () => {
    expect(phoneStageCss).toMatch(
      /\.phone-frame\.phone-frame-fullscreen\s*\{[\s\S]*max-height:\s*none/,
    )
  })
})
