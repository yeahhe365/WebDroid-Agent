import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TakeOverKind } from '../lib/actionTypes'
import { createAgentSession, type AgentSession } from '../lib/agent'
import {
  recoverInterruptedThread,
  type AgentThread,
  type AgentThreadStatus,
  type ReviewKind,
} from '../lib/agentThread'
import type { FailureClass } from '../lib/failureTaxonomy'
import type { AppCopy } from '../lib/appCopy'
import { buildInteractionStream } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { LogEntryInput } from '../lib/runLogEntries'
import { toLogScreenshot } from '../lib/runLogEntries'
import type { AppSettings } from '../lib/settings'
import {
  createIndexedDbThreadStore,
  createSettingsSnapshot,
  type AgentThreadSummary,
} from '../lib/threadStore'
import { useLatestValue } from './useLatestValue'

type UseAgentSessionHistoryInput = {
  addLog: (entry: LogEntryInput) => void
  copy: AppCopy
  currentSettings: AppSettings
  initialSettings: AppSettings
  onSessionStateChange: (session: AgentSession) => void
}

type DeleteHistoryThreadResult = {
  deleted: boolean
  resetActiveThread: boolean
}

export type AgentSessionSummary = {
  status: AgentThreadStatus
  stepNumber: number
  turnCount: number
  pendingUserMessageCount: number
  contextCompactedThroughStep: number
  latestStatusMessage?: string
  latestFailureClass?: FailureClass
  /** Structured reason from the latest takeover turn, when the model provided one. */
  latestTakeoverKind?: TakeOverKind
  /** Structured reason from the latest review status/turn. */
  latestReviewKind?: ReviewKind
  /** Wall-clock start of the latest run, from its user message. */
  runStartedAt?: number
  /** Wall-clock end of the latest run, once it is no longer running. */
  runFinishedAt?: number
  runStepCount: number
  /** Sum of provider-reported token usage across the latest run. */
  runTokenCount?: number
  updatedAt: number
}

export function useAgentSessionHistory({
  addLog,
  copy,
  currentSettings,
  initialSettings,
  onSessionStateChange,
}: UseAgentSessionHistoryInput) {
  const initialSession = useMemo(() => createSessionWithSettings(initialSettings), [initialSettings])
  const sessionRef = useRef<AgentSession>(initialSession)
  const [conversation, setConversation] = useState<AgentConversationMessage[]>(() => [
    ...initialSession.messages,
  ])
  const [interactionItems, setInteractionItems] = useState(() =>
    buildInteractionStream(initialSession),
  )
  const [sessionSummary, setSessionSummary] = useState(() => summarizeSession(initialSession))
  const threadStore = useMemo(() => createIndexedDbThreadStore(), [])
  const [threadStoreReady, setThreadStoreReady] = useState(false)
  const [threadSummaries, setThreadSummaries] = useState<AgentThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState(initialSession.id)
  const copyRef = useLatestValue(copy)

  const applyThreadSummaries = useCallback((summaries: AgentThreadSummary[]) => {
    setThreadSummaries(summaries.filter(isVisibleThreadSummary))
  }, [])

  const applySessionState = useCallback(
    (session: AgentSession) => {
      setActiveThreadId(session.id)
      setConversation([...session.messages])
      setInteractionItems(buildInteractionStream(session))
      setSessionSummary(summarizeSession(session))
      onSessionStateChange(session)
    },
    [onSessionStateChange],
  )

  const refreshThreadSummaries = useCallback(() => {
    if (!threadStoreReady) {
      return
    }

    void threadStore
      .list()
      .then(applyThreadSummaries)
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      })
  }, [addLog, applyThreadSummaries, copyRef, threadStore, threadStoreReady])

  const persistSession = useCallback(
    (session = sessionRef.current) => {
      if (!threadStoreReady) {
        return
      }
      if (!sessionHasHistoryContent(session)) {
        refreshThreadSummaries()
        return
      }

      session.settingsSnapshot = createSettingsSnapshot(currentSettings)
      void threadStore
        .save(session)
        .then(() => threadStore.list())
        .then(applyThreadSummaries)
        .catch((caught) => {
          const message = caught instanceof Error ? caught.message : String(caught)
          addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        })
    },
    [
      addLog,
      applyThreadSummaries,
      copyRef,
      currentSettings,
      refreshThreadSummaries,
      threadStore,
      threadStoreReady,
    ],
  )
  const persistSessionRef = useLatestValue(persistSession)

  const syncConversation = useCallback(() => {
    applySessionState(sessionRef.current)
    persistSession()
  }, [applySessionState, persistSession])

  const startNewSession = useCallback(() => {
    sessionRef.current = createSessionWithSettings(currentSettings)
    syncConversation()
  }, [currentSettings, syncConversation])

  const selectHistoryThread = useCallback(
    async (threadId: string) => {
      try {
        const selectedThread = await threadStore.load(threadId)
        if (!selectedThread) {
          refreshThreadSummaries()
          return false
        }

        const recovered = recoverInterruptedThread(
          selectedThread,
          copyRef.current.previousRunInterrupted,
        )
        sessionRef.current = selectedThread
        applySessionState(selectedThread)
        addLog({
          tone: 'info',
          title: copyRef.current.agentContextRestored,
          detail: selectedThread.title,
          screenshot: toLogScreenshot(
            selectedThread.lastScreenshot ?? selectedThread.deviceSnapshot?.screenshot,
          ),
        })
        if (recovered) {
          persistSessionRef.current(selectedThread)
        }
        return true
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        return false
      }
    },
    [addLog, applySessionState, copyRef, persistSessionRef, refreshThreadSummaries, threadStore],
  )

  const deleteHistoryThread = useCallback(
    async (threadId: string): Promise<DeleteHistoryThreadResult> => {
      try {
        await threadStore.delete(threadId)
        const resetActiveThread = threadId === sessionRef.current.id
        if (resetActiveThread) {
          sessionRef.current = createSessionWithSettings(currentSettings)
          applySessionState(sessionRef.current)
        }

        const summaries = await threadStore.list()
        applyThreadSummaries(summaries)
        return { deleted: true, resetActiveThread }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        return { deleted: false, resetActiveThread: false }
      }
    },
    [addLog, applySessionState, applyThreadSummaries, copyRef, currentSettings, threadStore],
  )

  const clearHistoryThreads = useCallback(async () => {
    try {
      await threadStore.clear()
      sessionRef.current = createSessionWithSettings(currentSettings)
      applySessionState(sessionRef.current)
      setThreadSummaries([])
      addLog({ tone: 'info', title: copyRef.current.chatHistoryCleared })
      return true
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      return false
    }
  }, [addLog, applySessionState, copyRef, currentSettings, threadStore])

  const exportChatHistory = useCallback(async () => {
    if (!threadStoreReady) {
      return null
    }
    try {
      const threads = await threadStore.loadAll()
      return { count: threads.length, threads }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      return null
    }
  }, [addLog, copyRef, threadStore, threadStoreReady])

  const importChatHistory = useCallback(
    async (threads: AgentThread[]) => {
      if (!threadStoreReady) {
        return 0
      }
      let imported = 0
      try {
        for (const thread of threads) {
          // save() overwrites on matching id (IDB put semantics); importing a
          // thread with an existing id replaces it.
          await threadStore.save(thread)
          imported += 1
        }
        const summaries = await threadStore.list()
        applyThreadSummaries(summaries)
        addLog({ tone: 'info', title: copyRef.current.chatHistoryImported(imported) })
        return imported
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        return imported
      }
    },
    [addLog, applyThreadSummaries, copyRef, threadStore, threadStoreReady],
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const restoredThread = await threadStore.loadLatest()
        if (!cancelled && restoredThread) {
          const recovered = recoverInterruptedThread(
            restoredThread,
            copyRef.current.previousRunInterrupted,
          )
          sessionRef.current = restoredThread
          applySessionState(restoredThread)
          addLog({
            tone: 'info',
            title: copyRef.current.agentContextRestored,
            detail: restoredThread.title,
            screenshot: toLogScreenshot(
              restoredThread.lastScreenshot ?? restoredThread.deviceSnapshot?.screenshot,
            ),
          })
          if (recovered) {
            persistSessionRef.current(restoredThread)
          }
        }
      } catch (caught) {
        if (cancelled) {
          return
        }
        const message = caught instanceof Error ? caught.message : String(caught)
        addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
      }

      try {
        const summaries = await threadStore.list()
        if (!cancelled) {
          applyThreadSummaries(summaries)
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught)
          addLog({ tone: 'warn', title: copyRef.current.agentContextRestoreSkipped, detail: message })
        }
      } finally {
        if (!cancelled) {
          setThreadStoreReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addLog, applySessionState, applyThreadSummaries, copyRef, persistSessionRef, threadStore])

  useEffect(() => {
    if (!threadStoreReady) {
      return
    }
    persistSession()
  }, [persistSession, threadStoreReady])

  return {
    activeThreadId,
    clearHistoryThreads,
    conversation,
    deleteHistoryThread,
    ensureSession: () => sessionRef.current,
    exportChatHistory,
    importChatHistory,
    interactionItems,
    selectHistoryThread,
    sessionSummary,
    startNewSession,
    syncConversation,
    threadSummaries,
  }
}

export function summarizeSession(session: AgentSession): AgentSessionSummary {
  const latestStatusEvent = [...session.events]
    .reverse()
    .find((event) => event.type === 'status_change')
  const latestUserMessageEvent = [...session.events]
    .reverse()
    .find((event) => event.type === 'user_message')
  const latestTurn = session.turns.at(-1)
  const latestAction = latestTurn?.action
  const latestTakeoverKind =
    session.status === 'awaiting_takeover'
      ? latestTurn?.takeoverKind ??
        (latestAction?.action === 'take_over' ? latestAction.kind : undefined)
      : undefined
  const latestTakeoverMessage =
    session.status === 'awaiting_takeover' && latestAction?.action === 'take_over'
      ? latestAction.message
      : undefined
  const latestStatusMessage =
    (latestStatusEvent?.type === 'status_change' ? latestStatusEvent.message : undefined) ??
    latestTakeoverMessage
  const latestReviewKind =
    session.status === 'awaiting_review'
      ? latestStatusEvent?.type === 'status_change' && latestStatusEvent.reviewKind
        ? latestStatusEvent.reviewKind
        : latestTurn?.reviewKind
      : undefined
  const runStartedAt = latestUserMessageEvent?.type === 'user_message'
    ? latestUserMessageEvent.createdAt
    : session.turns[0]?.createdAt
  const runTurns = runStartedAt === undefined
    ? session.turns
    : session.turns.filter((turn) => turn.createdAt >= runStartedAt)
  const runTokenCount = runTurns.reduce(
    (total, turn) => total + (turn.usage?.totalTokens ?? 0),
    0,
  )
  const runFinishedAt = latestStatusEvent?.type === 'status_change' &&
    latestStatusEvent.status !== 'running' &&
    latestStatusEvent.status !== 'idle'
    ? latestStatusEvent.createdAt
    : undefined

  return {
    status: session.status,
    stepNumber: session.stepNumber,
    turnCount: session.turns.length,
    pendingUserMessageCount: session.pendingUserMessages.length,
    contextCompactedThroughStep: session.contextCompactedThroughStep,
    ...(latestStatusMessage ? { latestStatusMessage } : {}),
    ...(latestStatusEvent?.type === 'status_change' && latestStatusEvent.failureClass
      ? { latestFailureClass: latestStatusEvent.failureClass }
      : {}),
    ...(latestTakeoverKind ? { latestTakeoverKind } : {}),
    ...(latestReviewKind ? { latestReviewKind } : {}),
    ...(runStartedAt !== undefined ? { runStartedAt } : {}),
    ...(runFinishedAt !== undefined ? { runFinishedAt } : {}),
    runStepCount: runTurns.length,
    ...(runTokenCount > 0 ? { runTokenCount } : {}),
    updatedAt: session.updatedAt,
  }
}

function createSessionWithSettings(settings: AppSettings) {
  const session = createAgentSession('')
  session.settingsSnapshot = createSettingsSnapshot(settings)
  return session
}

function sessionHasHistoryContent(session: AgentSession) {
  return (
    session.task.trim().length > 0 ||
    session.messages.length > 0 ||
    session.turns.length > 0 ||
    session.history.length > 0
  )
}

function isVisibleThreadSummary(summary: AgentThreadSummary) {
  return (
    summary.task.trim().length > 0 ||
    summary.status !== 'idle' ||
    summary.createdAt !== summary.updatedAt
  )
}
