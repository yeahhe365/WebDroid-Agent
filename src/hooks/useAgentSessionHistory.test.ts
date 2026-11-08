import { describe, expect, it } from 'vitest'
import type { DeviceScreenshot } from '../adapters/deviceTypes'
import {
  createAgentThread,
  recordThreadStatus,
  recordThreadTurnExecution,
  startThreadTurn,
} from '../lib/agentThread'
import { summarizeSession } from './useAgentSessionHistory'

const screenshot: DeviceScreenshot = {
  bytes: new Uint8Array([1, 2, 3]),
  dataUrl: 'data:image/png;base64,abc',
  screen: { width: 1080, height: 2400 },
}

describe('summarizeSession', () => {
  it('carries the structured takeover kind into the session summary', () => {
    const thread = createAgentThread('Enter the code', { now: 1000 })
    const action = {
      action: 'take_over' as const,
      kind: 'captcha' as const,
      message: 'Enter the one-time code.',
    }
    startThreadTurn(thread, {
      index: 1,
      task: 'Enter the code',
      promptContext: 'Task: Enter the code',
      modelOutput: '{"action":"take_over","kind":"captcha"}',
      action,
      executionAction: action,
      preview: 'take over: Enter the one-time code.',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 1100,
    })
    recordThreadStatus(thread, 'awaiting_takeover', undefined, { now: 1200 })

    const summary = summarizeSession(thread)

    expect(summary.latestTakeoverKind).toBe('captcha')
    expect(summary.latestStatusMessage).toBe('Enter the one-time code.')
  })

  it('uses the kind recorded by the local safety policy', () => {
    const thread = createAgentThread('Sign in', { now: 2000 })
    const action = { action: 'input_text' as const, text: 'hunter2' }
    const turn = startThreadTurn(thread, {
      index: 1,
      task: 'Sign in',
      promptContext: 'Task: Sign in',
      modelOutput: '{"action":"input_text","text":"hunter2"}',
      action,
      executionAction: action,
      preview: 'input text "hunter2"',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
        screenshot,
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      now: 2100,
    })
    recordThreadTurnExecution(thread, turn.id, {
      executionResult:
        'Safety policy requires manual takeover for login, password, captcha, or verification-code steps.',
      safetyDecision: 'take_over',
      takeoverKind: 'login',
      success: false,
      now: 2200,
    })
    recordThreadStatus(thread, 'awaiting_takeover', 'Safety policy requires manual takeover.', {
      now: 2300,
    })

    const summary = summarizeSession(thread)

    expect(summary.latestTakeoverKind).toBe('login')
  })

  it('carries the structured review kind into the session summary', () => {
    const thread = createAgentThread('Choose an account', { now: 3000 })
    recordThreadStatus(thread, 'awaiting_review', 'Which account should I use', {
      reviewKind: 'answer',
      now: 3100,
    })

    const summary = summarizeSession(thread)

    expect(summary.latestReviewKind).toBe('answer')
  })
})
