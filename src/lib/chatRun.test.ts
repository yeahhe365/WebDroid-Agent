import { describe, expect, it } from 'vitest'
import type { AgentAction } from './actionTypes'
import { createAgentThread, startThreadTurn } from './agentThread'
import { groupChatItems, turnNarrative } from './chatRun'
import type { InteractionStreamItem } from './interactionStream'
import { createUnknownDeviceState } from './deviceState'

function makeTurn(index: number, reason = 'open Wi-Fi') {
  const thread = createAgentThread('Open Wi-Fi', { now: 1000 })
  const action: AgentAction = { action: 'tap', x: 10, y: 20, reason }
  return startThreadTurn(thread, {
    id: `turn-${index}`,
    index,
    task: 'Open Wi-Fi',
    promptContext: 'Task: Open Wi-Fi',
    modelOutput: '{"action":"tap"}',
    action,
    executionAction: action,
    preview: `tap (10, 20) - ${reason}`,
    deviceSnapshot: {
      currentApp: 'Settings',
      deviceState: createUnknownDeviceState(),
    },
    timing: {
      captureMs: 1,
      currentAppMs: 2,
      modelMs: 3,
      parseMs: 4,
      totalMs: 10,
    },
    now: 1100 + index,
  })
}

describe('groupChatItems', () => {
  it('groups consecutive steps into one run and keeps messages in place', () => {
    const first = makeTurn(1)
    const second = makeTurn(2, 'tap Wi-Fi')
    const items: InteractionStreamItem[] = [
      {
        type: 'message',
        id: 'message-1',
        message: { id: 'message-1', role: 'user', content: 'Open Wi-Fi' },
      },
      { type: 'step', id: `step-${first.id}`, turn: first },
      { type: 'step', id: `step-${second.id}`, turn: second },
      {
        type: 'message',
        id: 'message-2',
        message: { id: 'message-2', role: 'assistant', content: 'Done' },
      },
      { type: 'step', id: 'step-3', turn: makeTurn(3) },
    ]

    const grouped = groupChatItems(items)

    expect(grouped.map((item) => item.type)).toEqual(['message', 'run', 'message', 'run'])
    expect(grouped[1]).toMatchObject({ type: 'run', turns: [first, second] })
    expect(grouped[3]).toMatchObject({ type: 'run', turns: [expect.objectContaining({ index: 3 })] })
  })
})

describe('turnNarrative', () => {
  it('prefers the action reason and otherwise uses the preview tail', () => {
    expect(turnNarrative(makeTurn(1, 'open Wi-Fi'))).toBe('open Wi-Fi')

    const thread = createAgentThread('Finish', { now: 1000 })
    const action: AgentAction = { action: 'done', summary: 'Task complete' }
    const turn = startThreadTurn(thread, {
      id: 'done-turn',
      index: 1,
      task: 'Finish',
      promptContext: 'Task: Finish',
      modelOutput: '{"action":"done"}',
      action,
      executionAction: action,
      preview: 'done - Task complete',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: createUnknownDeviceState(),
      },
      timing: {
        captureMs: 1,
        currentAppMs: 2,
        modelMs: 3,
        parseMs: 4,
        totalMs: 10,
      },
    })

    expect(turnNarrative(turn)).toBe('Task complete')
  })
})
