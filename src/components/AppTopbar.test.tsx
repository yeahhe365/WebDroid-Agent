// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_COPY } from '../lib/appCopy'
import { AppTopbar } from './AppTopbar'
import { AppProvider } from './AppContext'

afterEach(cleanup)

function renderTopbar(props: Partial<Parameters<typeof AppTopbar>[0]> = {}) {
  const onPauseRun = vi.fn()
  render(
    <AppProvider value={{ copy: APP_COPY['en-US'], locale: 'en-US' }}>
      <AppTopbar
        deviceConnected
        hasModelConfig
        isAgentRunning
        isTutorialOpen={false}
        onOpenConfig={vi.fn()}
        onOpenInspect={vi.fn()}
        onOpenSettings={vi.fn()}
        onPauseRun={onPauseRun}
        onStopRun={vi.fn()}
        onToggleTutorial={vi.fn()}
        runningStep={3}
        {...props}
      />
    </AppProvider>,
  )
  return { onPauseRun }
}

describe('AppTopbar run strip', () => {
  it('offers the pause control and the running step while a run is active', () => {
    const { onPauseRun } = renderTopbar()

    expect(screen.getByText(APP_COPY['en-US'].agentRunningStep(3))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: APP_COPY['en-US'].pauseRun }))
    expect(onPauseRun).toHaveBeenCalledTimes(1)
  })

  it('says it is pausing and blocks a second request until the step finishes', () => {
    const { onPauseRun } = renderTopbar({ runPausing: true })

    // Both the strip label and the button read "Pausing…": the strip is the
    // status, the button is the (now inert) control.
    expect(screen.getAllByText(APP_COPY['en-US'].pauseRunPending)).toHaveLength(2)
    const pause = screen.getByRole('button', { name: APP_COPY['en-US'].pauseRunPending })
    expect(pause).toHaveProperty('disabled', true)
    fireEvent.click(pause)
    expect(onPauseRun).not.toHaveBeenCalled()
  })
})
