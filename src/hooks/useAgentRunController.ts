import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceBackend } from '../adapters/deviceTypes'
import {
  addUserMessage,
  createAgentRunner,
  recordAgentStepExecutionDuration,
  recordAgentFinalResponse,
  recordAgentStep,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentSession,
  type AgentStep,
} from '../lib/agent'
import { recordThreadStatus } from '../lib/agentThread'
import type { AgentAction } from '../lib/actionTypes'
import type { AppCopy } from '../lib/appCopy'
import type { ActionProtocol } from '../lib/actionProtocol'
import type { AppCardMap } from '../lib/appCards'
import type { CustomToolDefinition, SecretRecord } from '../lib/agentResources'
import { delayWithAbort } from '../lib/abortSignal'
import type { BusyTask, BusyTaskId } from '../lib/busyTask'
import type { OpenAiClient, ModelConfig } from '../lib/openAiTypes'
import type { LogEntryInput } from '../lib/runLogEntries'
import {
  buildAgentStepTimeline,
  formatAgentStepDetail,
  toLogScreenshot,
} from '../lib/runLogEntries'
import type { ActionToolRegistry } from '../lib/toolRegistry'
import type { DeviceSnapshotUpdate } from './useDeviceController'

type RunTask = (id: BusyTaskId, label: string, action: () => Promise<void>) => Promise<void>

const COORDINATE_ACTION_PREVIEW_MS = 2000

export type RunEndNotification = {
  status: AgentRunStatus | 'error'
  title: string
  detail?: string
}

type UseAgentRunControllerInput = {
  actionProtocol: ActionProtocol
  actionToolRegistry: ActionToolRegistry
  addLog: (entry: LogEntryInput) => void
  appCards: AppCardMap
  backend: DeviceBackend
  busyTask: BusyTask | null
  canRunAgent: boolean
  client: OpenAiClient
  copy: AppCopy
  customTools: readonly CustomToolDefinition[]
  device: {
    applyDeviceSnapshot: (snapshot: DeviceSnapshotUpdate) => void
    confirmSensitiveAction: (message: string, action: AgentAction) => boolean | Promise<boolean>
    refreshDisplayedSnapshot: () => Promise<{
      screenshot: DeviceSnapshotUpdate['screenshot']
      deviceState: DeviceSnapshotUpdate['deviceState']
    }>
  }
  ensureSession: () => AgentSession
  maxSteps: number
  memoryEnabled: boolean
  memoryItems: readonly string[]
  modelConfig: ModelConfig
  onMemoryItem: (information: string) => void
  onRunEndNotification?: (notification: RunEndNotification) => void
  pendingStep: AgentStep | null
  runTask: RunTask
  setError: (value: string | null) => void
  setPendingStep: (step: AgentStep | null) => void
  secrets: readonly SecretRecord[]
  screenBlackoutDuringAutoControl: boolean
  streamResponses: boolean
  syncConversation: () => void
  unrestrictedMode: boolean
  onIrreversibleBlocked?: (action: AgentAction, message: string) => void
}

export function useAgentRunController({
  actionProtocol,
  actionToolRegistry,
  addLog,
  appCards,
  backend,
  busyTask,
  canRunAgent,
  client,
  copy,
  customTools,
  device,
  ensureSession,
  maxSteps,
  memoryEnabled,
  memoryItems,
  modelConfig,
  onMemoryItem,
  onRunEndNotification,
  pendingStep,
  runTask,
  setError,
  setPendingStep,
  secrets,
  screenBlackoutDuringAutoControl,
  streamResponses,
  syncConversation,
  unrestrictedMode,
  onIrreversibleBlocked,
}: UseAgentRunControllerInput) {
  const abortRef = useRef<AbortController | null>(null)
  const pendingAbortRef = useRef<AbortController | null>(null)
  const flushingQueuedMessageRef = useRef(false)
  const queuedMessagesRef = useRef<string[]>([])
  const [queuedChatMessages, setQueuedChatMessages] = useState<string[]>([])

  const executePendingStep = useCallback(async () => {
    if (!pendingStep) {
      return
    }

    const pendingAbort = new AbortController()
    pendingAbortRef.current = pendingAbort

    await runTask('execute-action', copy.executeActionTask, async () => {
      try {
      if (pendingStep.action.action === 'done') {
        recordAgentStep(ensureSession(), pendingStep, undefined, undefined, {
          memoryEnabled,
          onMemoryItem,
        })
        const finalResponse = await recordAgentFinalResponse({
          client,
          modelConfig: { ...modelConfig, stream: streamResponses },
          session: ensureSession(),
          task: ensureSession().task,
          signal: pendingAbort.signal,
        })
        addLog({ tone: 'ok', title: copy.taskComplete, detail: finalResponse })
        recordThreadStatus(ensureSession(), 'done', finalResponse)
        notifyRunEnd(
          onRunEndNotification,
          createRunEndNotification(
            { status: 'done', steps: [pendingStep], finalResponse },
            copy,
            maxSteps,
          ),
        )
        setPendingStep(null)
        syncConversation()
        return
      }

      recordThreadStatus(ensureSession(), 'running', copy.executeActionTask)
      syncConversation()
      const executionStartedAt = performance.now()
      const result = await actionToolRegistry.execute(pendingStep.executionAction, {
        device: backend,
        confirmSensitiveAction: device.confirmSensitiveAction,
        unrestrictedMode,
        safetyContext: {
          task: ensureSession().task,
          currentApp: pendingStep.currentApp,
          deviceState: pendingStep.deviceState,
          modelOutput: pendingStep.modelOutput,
        },
        customTools,
        secrets,
        screenshotRecallThread: ensureSession(),
        signal: pendingAbort.signal,
        onIrreversibleBlocked,
      })
      recordAgentStepExecutionDuration(pendingStep, performance.now() - executionStartedAt)
      pendingStep.toolName = result.toolName
      recordAgentStep(ensureSession(), pendingStep, result.summary, result.success, {
        memoryEnabled,
        onMemoryItem,
      })
      addLog({
        tone: result.success ? 'ok' : 'error',
        title: result.success
          ? copy.executedAction(pendingStep.preview)
          : copy.failedAction(pendingStep.preview),
        detail: result.summary,
        screenshot: toLogScreenshot(pendingStep.screenshot),
        timeline: buildAgentStepTimeline(pendingStep, result.summary),
      })
      if (!result.success) {
        setError(result.summary)
        recordThreadStatus(
          ensureSession(),
          result.safetyDecision === 'take_over' ? 'awaiting_takeover' : 'awaiting_review',
          result.summary,
        )
      } else {
        recordThreadStatus(ensureSession(), 'idle')
      }
      setPendingStep(null)
      await device.refreshDisplayedSnapshot()
      syncConversation()
      } finally {
        if (pendingAbortRef.current === pendingAbort) {
          pendingAbortRef.current = null
        }
      }
    })
  }, [
    actionToolRegistry,
    addLog,
    backend,
    client,
    copy,
    customTools,
    device,
    ensureSession,
    memoryEnabled,
    onIrreversibleBlocked,
    onMemoryItem,
    onRunEndNotification,
    modelConfig,
    maxSteps,
    pendingStep,
    runTask,
    setError,
    setPendingStep,
    secrets,
    streamResponses,
    syncConversation,
    unrestrictedMode,
  ])

  const runAutoLoop = useCallback(async () => {
    const session = ensureSession()
    const abortController = new AbortController()
    abortRef.current = abortController

    await runTask('run-agent', copy.runAgentTask, async () => {
      let screenBlackoutActive = false
      try {
        recordThreadStatus(session, 'running', copy.runAgentTask)
        syncConversation()
        screenBlackoutActive = await startScreenBlackoutForAutoControl({
          addLog,
          backend,
          copy,
          enabled: screenBlackoutDuringAutoControl,
        })
        const runner = createAgentRunner({ device: backend, client, toolRegistry: actionToolRegistry })
        const result = await runner.run({
          modelConfig: { ...modelConfig, stream: streamResponses },
          actionProtocol,
          task: session.task,
          autoExecute: true,
          appCards,
          customTools,
          maxSteps,
          memoryEnabled,
          memoryItems,
          session,
          secrets,
          signal: abortController.signal,
          onMemoryItem,
          confirmSensitiveAction: device.confirmSensitiveAction,
          unrestrictedMode,
          onSnapshot: device.applyDeviceSnapshot,
          onStep: async (step) => {
            device.applyDeviceSnapshot(step)
            setPendingStep(step.action.action === 'done' ? null : step)
            addLog({
              tone: 'info',
              title: copy.stepPreview(step.index, step.preview),
              detail: formatAgentStepDetail(step),
              screenshot: toLogScreenshot(step.screenshot),
              timeline: buildAgentStepTimeline(step),
            })
            syncConversation()
            if (isCoordinatePreviewAction(step.action)) {
              await delayWithAbort(COORDINATE_ACTION_PREVIEW_MS, abortController.signal)
            }
          },
          onExecuted: async (step, commandResult) => {
            addLog({
              tone: 'ok',
              title: copy.executedAction(step.preview),
              detail: commandResult,
              screenshot: toLogScreenshot(step.screenshot),
              timeline: buildAgentStepTimeline(step, commandResult),
            })
            setPendingStep(null)
            await device.refreshDisplayedSnapshot()
            syncConversation()
          },
        })

        if (result.status === 'done') {
          addLog({ tone: 'ok', title: copy.taskComplete, detail: result.finalResponse })
          recordThreadStatus(session, 'done', result.finalResponse)
        }
        if (result.status === 'max_steps') {
          addLog({ tone: 'warn', title: copy.maxStepsReached, detail: `${maxSteps} steps` })
          recordThreadStatus(session, 'awaiting_review', `${copy.maxStepsReached}: ${maxSteps}`)
        }
        if (result.status === 'stopped') {
          addLog({ tone: 'warn', title: copy.runStopped })
          recordThreadStatus(session, 'stopped', copy.runStopped)
        }
        if (result.status === 'awaiting_review') {
          addLog({ tone: 'warn', title: copy.stepStatusAwaitingReview, detail: result.reason })
          recordThreadStatus(session, 'awaiting_review', result.reason)
        }
        if (result.status === 'awaiting_takeover') {
          addLog({ tone: 'warn', title: copy.manualTakeoverRequested })
          recordThreadStatus(session, 'awaiting_takeover', result.reason)
        }
        if (result.status === 'loop_guard') {
          addLog({ tone: 'warn', title: copy.loopGuardStopped, detail: result.reason })
          recordThreadStatus(session, 'stopped', result.reason ?? copy.loopGuardStopped)
        }
        notifyRunEnd(onRunEndNotification, createRunEndNotification(result, copy, maxSteps))
        if (result.status !== 'awaiting_takeover') {
          setPendingStep(null)
        }
        syncConversation()
      } catch (caught) {
        const message = formatCaughtError(caught)
        recordThreadStatus(session, 'error', message)
        notifyRunEnd(onRunEndNotification, {
          status: 'error',
          title: copy.sessionStatusError,
          detail: message,
        })
        syncConversation()
        throw caught
      } finally {
        if (screenBlackoutActive) {
          await stopScreenBlackoutForAutoControl({ addLog, backend, copy })
        }
        if (abortRef.current === abortController) {
          abortRef.current = null
        }
      }
    })
  }, [
    actionToolRegistry,
    actionProtocol,
    addLog,
    appCards,
    backend,
    client,
    copy,
    customTools,
    device,
    ensureSession,
    maxSteps,
    memoryEnabled,
    memoryItems,
    modelConfig,
    onMemoryItem,
    onRunEndNotification,
    runTask,
    screenBlackoutDuringAutoControl,
    secrets,
    setPendingStep,
    streamResponses,
    syncConversation,
    unrestrictedMode,
  ])

  const sendChatMessage = useCallback(async (message: string) => {
    const session = ensureSession()

    addUserMessage(session, message)
    syncConversation()
    addLog({ tone: 'info', title: copy.userMessage, detail: message })

    if (!canRunAgent) {
      return
    }

    await runAutoLoop()
  }, [
    addLog,
    canRunAgent,
    copy,
    ensureSession,
    runAutoLoop,
    syncConversation,
  ])

  const submitChatMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim()
      if (!message) {
        return
      }

      if (busyTask) {
        queuedMessagesRef.current = [...queuedMessagesRef.current, message]
        setQueuedChatMessages([...queuedMessagesRef.current])
        addLog({ tone: 'info', title: copy.userMessageQueued, detail: message })
        return
      }

      await sendChatMessage(message)
    },
    [addLog, busyTask, copy, sendChatMessage],
  )

  const flushNextQueuedMessage = useCallback(async () => {
    if (flushingQueuedMessageRef.current || queuedMessagesRef.current.length === 0) {
      return
    }

    flushingQueuedMessageRef.current = true
    const message = queuedMessagesRef.current[0]
    queuedMessagesRef.current = queuedMessagesRef.current.slice(1)
    setQueuedChatMessages([...queuedMessagesRef.current])

    try {
      await sendChatMessage(message)
    } finally {
      flushingQueuedMessageRef.current = false
    }
  }, [sendChatMessage])

  useEffect(() => {
    if (!busyTask && queuedMessagesRef.current.length > 0) {
      flushNextQueuedMessage()
    }
  }, [busyTask, flushNextQueuedMessage])

  const stopCurrentRun = useCallback(() => {
    abortRef.current?.abort()
    pendingAbortRef.current?.abort()
  }, [])

  return {
    executePendingStep,
    queuedChatMessageCount: queuedChatMessages.length,
    stopCurrentRun,
    submitChatMessage,
  }
}

export function createRunEndNotification(
  result: AgentRunResult,
  copy: AppCopy,
  maxSteps: number,
): RunEndNotification {
  if (result.status === 'done') {
    return {
      status: result.status,
      title: copy.taskComplete,
      detail: result.finalResponse,
    }
  }
  if (result.status === 'max_steps') {
    return {
      status: result.status,
      title: copy.maxStepsReached,
      detail: `${maxSteps} steps`,
    }
  }
  if (result.status === 'stopped') {
    return {
      status: result.status,
      title: copy.runStopped,
    }
  }
  if (result.status === 'awaiting_review') {
    return {
      status: result.status,
      title: copy.stepStatusAwaitingReview,
      detail: result.reason,
    }
  }
  if (result.status === 'awaiting_takeover') {
    return {
      status: result.status,
      title: copy.manualTakeoverRequested,
      detail: result.reason,
    }
  }

  return {
    status: result.status,
    title: copy.loopGuardStopped,
    detail: result.reason,
  }
}

function notifyRunEnd(
  onRunEndNotification: ((notification: RunEndNotification) => void) | undefined,
  notification: RunEndNotification,
) {
  try {
    onRunEndNotification?.(notification)
  } catch {
    // Browser notification failures should never interrupt the agent run lifecycle.
  }
}

function isCoordinatePreviewAction(action: AgentAction) {
  return (
    action.action === 'tap' ||
    action.action === 'swipe' ||
    action.action === 'long_press' ||
    action.action === 'double_tap'
  )
}

async function startScreenBlackoutForAutoControl({
  addLog,
  backend,
  copy,
  enabled,
}: {
  addLog: (entry: LogEntryInput) => void
  backend: DeviceBackend
  copy: AppCopy
  enabled: boolean
}) {
  if (!enabled) {
    return false
  }

  if (!backend.startScreenBlackout) {
    addLog({ tone: 'warn', title: copy.screenBlackoutStartFailed })
    return false
  }

  try {
    await backend.startScreenBlackout()
    return true
  } catch (caught) {
    addLog({
      tone: 'warn',
      title: copy.screenBlackoutStartFailed,
      detail: formatCaughtError(caught),
    })
    return false
  }
}

async function stopScreenBlackoutForAutoControl({
  addLog,
  backend,
  copy,
}: {
  addLog: (entry: LogEntryInput) => void
  backend: DeviceBackend
  copy: AppCopy
}) {
  if (!backend.stopScreenBlackout) {
    return
  }

  try {
    await backend.stopScreenBlackout()
  } catch (caught) {
    addLog({
      tone: 'error',
      title: copy.screenBlackoutRestoreFailed,
      detail: formatCaughtError(caught),
    })
  }
}

function formatCaughtError(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught)
}
