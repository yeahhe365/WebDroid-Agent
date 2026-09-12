// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentThread, startThreadTurn, type AgentTurn } from '../lib/agentThread'
import { APP_COPY } from '../lib/appCopy'
import { AgentStepCard } from './AgentStepCard'
import { AppProvider } from './AppContext'

function buildFailedTurn(): AgentTurn {
  const thread = createAgentThread('Open Wi-Fi settings', { now: 1000 })
  const action = { action: 'launch' as const, app: 'Settings' }
  const turn = startThreadTurn(thread, {
    index: 1,
    task: thread.task,
    promptContext: 'Task: Open Wi-Fi settings',
    modelOutput: '{"action":"launch","app":"Settings"}',
    action,
    executionAction: action,
    preview: 'launch Settings',
    deviceSnapshot: {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
    },
    timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    status: 'failed',
    now: 2000,
  })
  return turn
}

function renderCard(turn: AgentTurn) {
  return render(
    <AppProvider value={{ copy: APP_COPY['en-US'], locale: 'en-US' }}>
      <AgentStepCard isActive={false} turn={turn} />
    </AppProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('AgentStepCard failure class', () => {
  it('shows the recorded failure class on a failed step', () => {
    const turn = buildFailedTurn()
    turn.failureClass = 'device_timeout'

    const { container } = renderCard(turn)

    expect(screen.getByText('Failure class: device_timeout')).toBeTruthy()
    expect(container.querySelector('.agent-step-failure-class')?.textContent).toBe(
      'Failure class: device_timeout',
    )
  })

  it('renders no failure class line for a turn that has none', () => {
    const turn = buildFailedTurn()
    expect(turn.failureClass).toBeUndefined()

    const { container } = renderCard(turn)

    expect(container.querySelector('.agent-step-failure-class')).toBeNull()
    expect(screen.queryByText(/failure class/i)).toBeNull()
    // The card itself is unchanged: same failure tone and status label as before.
    expect(container.querySelector('.agent-step-card.failed')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })
})
