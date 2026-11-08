// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction } from '../lib/actionTypes'
import { createAgentThread, startThreadTurn, type AgentTurn } from '../lib/agentThread'
import { createUnknownDeviceState } from '../lib/deviceState'
import { APP_COPY } from '../lib/appCopy'
import { AppProvider } from './AppContext'
import { RunProgressBlock } from './RunProgressBlock'

afterEach(cleanup)

function makeTurn(index: number, usage?: { inputTokens: number; outputTokens: number; totalTokens: number }) {
  const thread = createAgentThread('Open Wi-Fi', { now: 1000 })
  const action: AgentAction = { action: 'tap', x: 10, y: 20, reason: `step ${index}` }
  const turn = startThreadTurn(thread, {
    id: `turn-${index}`,
    index,
    task: 'Open Wi-Fi',
    promptContext: 'Task: Open Wi-Fi',
    modelOutput: '{"action":"tap"}',
    action,
    executionAction: action,
    preview: `tap (10, 20) - step ${index}`,
    deviceSnapshot: {
      currentApp: 'Settings',
      deviceState: createUnknownDeviceState(),
    },
    timing: {
      captureMs: 1,
      currentAppMs: 2,
      executionMs: 10,
      modelMs: 3,
      parseMs: 4,
      totalMs: 10,
    },
    ...(usage ? { usage } : {}),
    now: 1000 + index,
  })
  turn.completedAt = 1000 + index
  return turn
}

function renderBlock(props: {
  active?: boolean
  turns: AgentTurn[]
  onOpenRunLog?: () => void
}) {
  const onOpenRunLog = props.onOpenRunLog ?? vi.fn()
  render(
    <AppProvider value={{ copy: APP_COPY['en-US'], locale: 'en-US' }}>
      <RunProgressBlock
        active={props.active ?? false}
        finishedAt={7000}
        onOpenRunLog={onOpenRunLog}
        startedAt={1000}
        turns={props.turns}
      />
    </AppProvider>,
  )
  return onOpenRunLog
}

describe('RunProgressBlock', () => {
  it('shows only the latest five steps while a run is active', () => {
    const turns = Array.from({ length: 7 }, (_, index) => makeTurn(index + 1))

    renderBlock({ active: true, turns })

    expect(screen.getByText('2 earlier steps')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Step \d+: Tap$/)).toHaveLength(5)
    expect(screen.getByText('Doing: step 7')).toBeTruthy()
  })

  it('collapses a completed run into steps, duration, tokens and process link', () => {
    const turns = Array.from({ length: 3 }, (_, index) =>
      makeTurn(index + 1, { inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
    )
    const onOpenRunLog = renderBlock({ turns })

    expect(screen.getByText('3 steps')).toBeTruthy()
    expect(screen.getByText('6s')).toBeTruthy()
    expect(screen.getByText('450 tokens')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View process' }))
    expect(onOpenRunLog).toHaveBeenCalledTimes(1)
  })
})
