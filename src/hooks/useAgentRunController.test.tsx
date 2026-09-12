// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceTypes'
import { createAgentSession, type AgentStep } from '../lib/agent'
import { createDefaultAppCards } from '../lib/appCards'
import { APP_COPY } from '../lib/appCopy'
import type { BusyTask } from '../lib/busyTask'
import type { OpenAiClient } from '../lib/openAiTypes'
import { createDefaultActionToolRegistry } from '../lib/toolRegistry'
import {
  createRunEndNotification,
  useAgentRunController,
} from './useAgentRunController'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function createDevice(): DeviceBackend {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    execute: vi.fn(async () => 'executed'),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({
      app: 'Chrome',
      packageName: 'com.android.chrome',
    })),
    getInstalledApps: vi.fn(async () => []),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })),
    startScreenBlackout: vi.fn(async () => 'screen dimmed'),
    stopScreenBlackout: vi.fn(async () => 'screen restored'),
  }
}

describe('useAgentRunController', () => {
  it('describes every automatic run terminal status for notifications', () => {
    const copy = APP_COPY['en-US']

    expect(
      createRunEndNotification({ status: 'done', steps: [], finalResponse: 'All done.' }, copy, 3),
    ).toEqual({ status: 'done', title: 'Task complete', detail: 'All done.' })
    expect(createRunEndNotification({ status: 'max_steps', steps: [] }, copy, 3)).toEqual({
      status: 'max_steps',
      title: 'Max steps reached',
      detail: '3 steps',
    })
    expect(createRunEndNotification({ status: 'stopped', steps: [] }, copy, 3)).toEqual({
      status: 'stopped',
      title: 'Run stopped',
    })
    expect(
      createRunEndNotification(
        { status: 'awaiting_review', steps: [], reason: 'Check this action.' },
        copy,
        3,
      ),
    ).toEqual({
      status: 'awaiting_review',
      title: 'Needs review',
      detail: 'Check this action.',
    })
    expect(
      createRunEndNotification(
        { status: 'awaiting_takeover', steps: [], reason: 'Human needed.' },
        copy,
        3,
      ),
    ).toEqual({
      status: 'awaiting_takeover',
      title: 'Manual takeover requested',
      detail: 'Human needed.',
    })
    expect(
      createRunEndNotification({ status: 'loop_guard', steps: [], reason: 'Repeated tap.' }, copy, 3),
    ).toEqual({
      status: 'loop_guard',
      title: 'Loop guard stopped the run',
      detail: 'Repeated tap.',
    })
  })

  it('notifies when an automatic run finishes', async () => {
    const backend = createDevice()
    const session = createAgentSession('')
    const onRunEndNotification = vi.fn()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"done"}'),
      completeFinalResponse: vi.fn(async () => 'All done.'),
    }

    const { result } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: createDefaultActionToolRegistry(),
        addLog: vi.fn(),
        appCards: createDefaultAppCards(),
        backend,
        busyTask: null,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot: vi.fn(async () => ({
            deviceState: { app: 'Chrome' },
            screenshot: {
              bytes: new Uint8Array(),
              dataUrl: 'data:image/png;base64,abc',
              screen: { width: 1080, height: 2400 },
            },
          })),
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        onRunEndNotification,
        pendingStep: null,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: false,
        secrets: [],
        setError: vi.fn(),
        setPendingStep: vi.fn(),
        streamResponses: false,
        syncConversation: vi.fn(),
        unrestrictedMode: false,
      }),
    )

    await act(async () => {
      await result.current.submitChatMessage('Finish the task.')
    })

    expect(onRunEndNotification).toHaveBeenCalledWith({
      status: 'done',
      title: APP_COPY['en-US'].taskComplete,
      detail: 'All done.',
    })
  })

  it('dims and restores the Android screen around automatic control when enabled', async () => {
    const backend = createDevice()
    const session = createAgentSession('')
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"done"}'),
      completeFinalResponse: vi.fn(async () => 'All done.'),
    }

    const { result } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: createDefaultActionToolRegistry(),
        addLog: vi.fn(),
        appCards: createDefaultAppCards(),
        backend,
        busyTask: null,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot: vi.fn(async () => ({
            deviceState: { app: 'Chrome' },
            screenshot: {
              bytes: new Uint8Array(),
              dataUrl: 'data:image/png;base64,abc',
              screen: { width: 1080, height: 2400 },
            },
          })),
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        pendingStep: null,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: true,
        secrets: [],
        setError: vi.fn(),
        setPendingStep: vi.fn(),
        streamResponses: false,
        syncConversation: vi.fn(),
        unrestrictedMode: false,
      }),
    )

    await act(async () => {
      await result.current.submitChatMessage('Finish the task.')
    })

    const startScreenBlackout = vi.mocked(backend.startScreenBlackout!)
    const stopScreenBlackout = vi.mocked(backend.stopScreenBlackout!)
    const screenshot = vi.mocked(backend.screenshot)
    const completeFinalResponse = vi.mocked(client.completeFinalResponse!)

    expect(startScreenBlackout).toHaveBeenCalledTimes(1)
    expect(stopScreenBlackout).toHaveBeenCalledTimes(1)
    expect(startScreenBlackout.mock.invocationCallOrder[0]!).toBeLessThan(
      screenshot.mock.invocationCallOrder[0]!,
    )
    expect(stopScreenBlackout.mock.invocationCallOrder[0]!).toBeGreaterThan(
      completeFinalResponse.mock.invocationCallOrder[0]!,
    )
  })

  it('clears the pending automatic action before refreshing the displayed screenshot', async () => {
    const backend = createDevice()
    const session = createAgentSession('')
    const setPendingStep = vi.fn()
    const refreshDisplayedSnapshot = vi.fn(async () => ({
      deviceState: { app: 'Chrome' },
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,after-tap',
        screen: { width: 1080, height: 2400 },
      },
    }))
    const client: OpenAiClient = {
      completeAction: vi
        .fn()
        .mockResolvedValueOnce('{"action":"tap","x":540,"y":1200}')
        .mockResolvedValueOnce('{"action":"done","summary":"done"}'),
      completeFinalResponse: vi.fn(async () => 'All done.'),
    }

    const { result } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: createDefaultActionToolRegistry(),
        addLog: vi.fn(),
        appCards: createDefaultAppCards(),
        backend,
        busyTask: null,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot,
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        pendingStep: null,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: false,
        secrets: [],
        setError: vi.fn(),
        setPendingStep,
        streamResponses: false,
        syncConversation: vi.fn(),
        unrestrictedMode: false,
      }),
    )

    await act(async () => {
      await result.current.submitChatMessage('Tap once.')
    })

    const firstClearOrder = setPendingStep.mock.invocationCallOrder.find(
      (_order, index) => setPendingStep.mock.calls[index]?.[0] === null,
    )

    expect(setPendingStep).toHaveBeenCalledWith(expect.objectContaining({ preview: 'tap (540, 1200)' }))
    expect(firstClearOrder).toBeLessThan(refreshDisplayedSnapshot.mock.invocationCallOrder[0]!)
  })

  it('keeps automatic coordinate action previews visible for two seconds before executing', async () => {
    vi.useFakeTimers()
    const backend = createDevice()
    const session = createAgentSession('')
    const setPendingStep = vi.fn()
    const client: OpenAiClient = {
      completeAction: vi
        .fn()
        .mockResolvedValueOnce('{"action":"tap","x":540,"y":1200}')
        .mockResolvedValueOnce('{"action":"done","summary":"done"}'),
      completeFinalResponse: vi.fn(async () => 'All done.'),
    }

    const { result } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: createDefaultActionToolRegistry(),
        addLog: vi.fn(),
        appCards: createDefaultAppCards(),
        backend,
        busyTask: null,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot: vi.fn(async () => ({
            deviceState: { app: 'Chrome' },
            screenshot: {
              bytes: new Uint8Array(),
              dataUrl: 'data:image/png;base64,after-tap',
              screen: { width: 1080, height: 2400 },
            },
          })),
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        pendingStep: null,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: false,
        secrets: [],
        setError: vi.fn(),
        setPendingStep,
        streamResponses: false,
        syncConversation: vi.fn(),
        unrestrictedMode: false,
      }),
    )

    const submitPromise = result.current.submitChatMessage('Tap once.')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setPendingStep).toHaveBeenCalledWith(expect.objectContaining({ preview: 'tap (540, 1200)' }))
    expect(backend.execute).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1999)
      await Promise.resolve()
    })
    expect(backend.execute).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(backend.execute).toHaveBeenCalledTimes(1)

    await act(async () => {
      await submitPromise
    })
  })

  it('queues composer submissions while busy and sends them after the current task finishes', async () => {
    const backend = createDevice()
    const session = createAgentSession('Current task')
    const addLog = vi.fn()
    const syncConversation = vi.fn()
    const client: OpenAiClient = {
      completeAction: vi.fn(async () => '{"action":"done","summary":"queued task done"}'),
      completeFinalResponse: vi.fn(async () => 'Queued task complete.'),
    }
    let busyTask: BusyTask | null = { id: 'run-agent', label: 'Run agent', startedAt: 1 }

    const { result, rerender } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: createDefaultActionToolRegistry(),
        addLog,
        appCards: createDefaultAppCards(),
        backend,
        busyTask,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot: vi.fn(async () => ({
            deviceState: { app: 'Chrome' },
            screenshot: {
              bytes: new Uint8Array(),
              dataUrl: 'data:image/png;base64,abc',
              screen: { width: 1080, height: 2400 },
            },
          })),
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        pendingStep: null,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: false,
        secrets: [],
        setError: vi.fn(),
        setPendingStep: vi.fn(),
        streamResponses: false,
        syncConversation,
        unrestrictedMode: false,
      }),
    )

    await act(async () => {
      await result.current.submitChatMessage('Run this after the current task.')
    })
    expect(result.current.queuedChatMessageCount).toBe(1)
    expect(session.messages.map((message) => message.content)).toEqual(['Current task'])
    expect(client.completeAction).not.toHaveBeenCalled()
    expect(addLog).toHaveBeenCalledWith({
      tone: 'info',
      title: APP_COPY['en-US'].userMessageQueued,
      detail: 'Run this after the current task.',
    })

    busyTask = null
    rerender()

    await waitFor(() => expect(client.completeAction).toHaveBeenCalledTimes(1))
    expect(session.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'Run this after the current task.',
        }),
      ]),
    )
    expect(session.pendingUserMessages).toEqual([])
  })

  it('aborts an in-flight manual step when the run is stopped', async () => {
    const backend = createDevice()
    const session = createAgentSession('')
    const registry = createDefaultActionToolRegistry()
    const captured: { signal?: AbortSignal } = {}

    vi.spyOn(registry, 'execute').mockImplementation(async (_action, context) => {
      captured.signal = context.signal
      await new Promise<void>((resolve) => {
        if (context.signal?.aborted) {
          resolve()
          return
        }
        context.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return { toolName: 'tap', success: true, summary: 'Stopped before the device command.' }
    })

    const pendingStep: AgentStep = {
      action: { action: 'tap', x: 540, y: 1200 },
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      executionAction: { action: 'tap', x: 540, y: 1200 },
      index: 1,
      modelOutput: '{"action":"tap","x":540,"y":1200}',
      preview: 'tap (540, 1200)',
      screenshot: {
        bytes: new Uint8Array(),
        dataUrl: 'data:image/png;base64,step',
        screen: { width: 1080, height: 2400 },
      },
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    }

    const client: OpenAiClient = {
      completeAction: vi.fn(),
      completeFinalResponse: vi.fn(async () => 'All done.'),
    }

    const { result } = renderHook(() =>
      useAgentRunController({
        actionProtocol: 'webdroid_json',
        actionToolRegistry: registry,
        addLog: vi.fn(),
        appCards: createDefaultAppCards(),
        backend,
        busyTask: null,
        canRunAgent: true,
        client,
        copy: APP_COPY['en-US'],
        customTools: [],
        device: {
          applyDeviceSnapshot: vi.fn(),
          confirmSensitiveAction: vi.fn(() => true),
          refreshDisplayedSnapshot: vi.fn(async () => ({
            deviceState: { app: 'Chrome' },
            screenshot: {
              bytes: new Uint8Array(),
              dataUrl: 'data:image/png;base64,after-stop',
              screen: { width: 1080, height: 2400 },
            },
          })),
        },
        ensureSession: () => session,
        maxSteps: 3,
        memoryEnabled: false,
        memoryItems: [],
        modelConfig: { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' },
        onMemoryItem: vi.fn(),
        pendingStep,
        runTask: async (_id, _label, action) => {
          await action()
        },
        screenBlackoutDuringAutoControl: false,
        secrets: [],
        setError: vi.fn(),
        setPendingStep: vi.fn(),
        streamResponses: false,
        syncConversation: vi.fn(),
        unrestrictedMode: false,
      }),
    )

    await act(async () => {
      const pending = result.current.executePendingStep()
      await waitFor(() => expect(captured.signal).toBeDefined())
      result.current.stopCurrentRun()
      await pending
    })

    expect(captured.signal?.aborted).toBe(true)
  })
})
