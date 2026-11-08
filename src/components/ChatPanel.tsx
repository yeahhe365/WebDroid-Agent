import {
  Activity,
  ArrowDown,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Pause,
  Send,
} from 'lucide-react'
import { IconNewChat, IconStop } from './icons'
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  Suspense,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from 'react'
import type { AppCopy } from '../lib/appCopy'
import type { AgentStep } from '../lib/agent'
import type { BusyTask } from '../lib/busyTask'
import type { AgentSessionSummary } from '../hooks/useAgentSessionHistory'
import { groupChatItems, type ChatDisplayItem } from '../lib/chatRun'
import type { InteractionStreamItem } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { AgentThreadSummary } from '../lib/threadStore'
import { useAppCopy } from './AppContext'
import { Button, IconButton } from './primitives'
import { LazyMarkdownContent } from './LazyMarkdownContent'
import { lazyWithRetry } from '../lib/lazyWithRetry'
import { PendingActionCard } from './PendingActionCard'

type ChatPanelProps = {
  activeThreadId: string
  busyTask: BusyTask | null
  conversation: AgentConversationMessage[]
  deviceConnected?: boolean
  hasModelConfig?: boolean
  interactionItems?: InteractionStreamItem[]
  historySidebarOpen: boolean
  pendingStep: AgentStep | null
  queuedChatMessageCount: number
  sessionSummary?: AgentSessionSummary
  threadSummaries: AgentThreadSummary[]
  onCloseHistorySidebar: () => void
  onConfigureModel?: () => void
  onConnectDevice?: () => void
  onDeleteThread: (threadId: string) => void
  onExecutePendingStep: () => void
  onOpenRunLog: () => void
  onPauseRun: () => void
  onResumeRun: () => void
  onSelectThread: (threadId: string) => void
  onStartNewChat: () => void
  onStopRun: () => void
  onSubmitChatMessage: (message: string) => void
  onToggleHistorySidebar: () => void
  /** A pause has been requested but the in-flight step has not finished yet. */
  runPausing?: boolean
}

const ChatHistorySidebar = lazyWithRetry(() =>
  import('./ChatHistorySidebar').then((module) => ({ default: module.ChatHistorySidebar })),
)
const NeedsYouCard = lazyWithRetry(() =>
  import('./NeedsYouCard').then((module) => ({ default: module.NeedsYouCard })),
)
const RunProgressBlock = lazyWithRetry(() =>
  import('./RunProgressBlock').then((module) => ({ default: module.RunProgressBlock })),
)
const RunProgressPlaceholder = lazyWithRetry(() =>
  import('./RunProgressBlock').then((module) => ({ default: module.RunProgressPlaceholder })),
)

const MAX_RENDERED_CHAT_ITEMS = 160

export function ChatPanel({
  activeThreadId,
  busyTask,
  conversation,
  deviceConnected = false,
  hasModelConfig = false,
  interactionItems,
  historySidebarOpen,
  pendingStep,
  threadSummaries,
  onCloseHistorySidebar,
  onConfigureModel,
  onConnectDevice,
  onDeleteThread,
  onExecutePendingStep,
  onOpenRunLog,
  onPauseRun,
  onResumeRun,
  onSelectThread,
  onStartNewChat,
  onStopRun,
  onSubmitChatMessage,
  onToggleHistorySidebar,
  sessionSummary,
  queuedChatMessageCount,
  runPausing = false,
}: ChatPanelProps) {
  const copy = useAppCopy()
  const chatInputId = useId()
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowOutputRef = useRef(true)
  const [composerThreadId, setComposerThreadId] = useState(activeThreadId)
  const [chatInput, setChatInput] = useState('')
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const restoreScrollHeightRef = useRef<number | null>(null)
  // Reset the draft when the active thread changes (new chat / history restore).
  if (composerThreadId !== activeThreadId) {
    setComposerThreadId(activeThreadId)
    setChatInput('')
    setShowAllHistory(false)
  }
  const chatIsEmpty = chatInput.trim().length === 0
  const isBusy = Boolean(busyTask)
  const canStopRun = busyTask?.id === 'run-agent'
  const items = groupChatItems(
    interactionItems ?? conversation.map<InteractionStreamItem>((message) => messageToItem(message)),
  )
  const hiddenItemCount = Math.max(0, items.length - MAX_RENDERED_CHAT_ITEMS)
  const visibleItems = useMemo(
    () => (showAllHistory ? items : items.slice(hiddenItemCount)),
    [hiddenItemCount, items, showAllHistory],
  )
  const latestRunItem = useMemo(
    () => [...visibleItems].reverse().find((item): item is ChatDisplayItem & { type: 'run' } => item.type === 'run'),
    [visibleItems],
  )
  const hasActiveRunTurns = !sessionSummary || sessionSummary.runStepCount > 0
  const chatInputRows = Math.min(6, Math.max(1, chatInput.split('\n').length))
  const visibleQueuedMessageCount =
    queuedChatMessageCount + (sessionSummary?.pendingUserMessageCount ?? 0)
  const sessionStripVisible =
    Boolean(busyTask) ||
    visibleQueuedMessageCount > 0 ||
    Boolean(sessionSummary && shouldShowSessionSummary(sessionSummary))
  const lastVisibleItem = visibleItems[visibleItems.length - 1]
  const lastItemSignature = lastVisibleItem
    ? lastVisibleItem.type === 'run'
      ? `${lastVisibleItem.id}:${lastVisibleItem.turns.length}:${
          lastVisibleItem.turns[lastVisibleItem.turns.length - 1]?.completedAt ?? 0
        }:${lastVisibleItem.turns[lastVisibleItem.turns.length - 1]?.usage?.totalTokens ?? 0}`
      : `${lastVisibleItem.id}:${lastVisibleItem.message.content.length}`
    : ''

  const submitChatIfNotEmpty = () => {
    if (chatIsEmpty) {
      return
    }
    const message = chatInput
    setChatInput('')
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto'
    }
    onSubmitChatMessage(message)
  }
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }

    event.preventDefault()
    // Allow queueing while busy; controller queues when a run is active.
    submitChatIfNotEmpty()
  }
  const handleChatInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(event.target.value)
    resizeComposer(event.currentTarget)
  }
  const handleStartNewChat = () => {
    onStartNewChat()
    setChatInput('')
    chatInputRef.current?.focus()
  }
  const handleHistoryNewChat = () => {
    handleStartNewChat()
    onCloseHistorySidebar()
  }
  const focusComposerShell = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, textarea, input, label')) {
      return
    }

    chatInputRef.current?.focus()
  }
  const handleStreamScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    const isNearBottom = distanceFromBottom < 96
    shouldFollowOutputRef.current = isNearBottom
    setShowScrollToBottom(!isNearBottom)
  }
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const stream = chatStreamRef.current
    if (!stream) {
      return
    }

    if (typeof stream.scrollTo === 'function') {
      stream.scrollTo({ top: stream.scrollHeight, behavior })
    } else {
      stream.scrollTop = stream.scrollHeight
    }
    shouldFollowOutputRef.current = true
    setShowScrollToBottom(false)
  }

  useEffect(() => {
    const input = chatInputRef.current
    if (input) {
      resizeComposer(input)
    }
  }, [chatInput])

  useEffect(() => {
    if (shouldFollowOutputRef.current) {
      scrollToBottom('auto')
    }
  }, [visibleItems.length, lastItemSignature, busyTask?.id, pendingStep?.index])

  useLayoutEffect(() => {
    if (restoreScrollHeightRef.current === null) {
      return
    }
    const stream = chatStreamRef.current
    if (stream) {
      stream.scrollTop += stream.scrollHeight - restoreScrollHeightRef.current
    }
    restoreScrollHeightRef.current = null
  }, [showAllHistory])


  return (
    <section className="chat-shell" aria-label={copy.chat}>
      {historySidebarOpen ? (
        <button
          type="button"
          className="chat-history-backdrop"
          aria-hidden="true"
          onClick={onCloseHistorySidebar}
          tabIndex={-1}
        />
      ) : null}
      <Suspense fallback={null}>
        <ChatHistorySidebar
          activeThreadId={activeThreadId}
          busyTask={busyTask}
          copy={copy}
          isOpen={historySidebarOpen}
          onClose={onCloseHistorySidebar}
          onDeleteThread={onDeleteThread}
          onNewChat={handleHistoryNewChat}
          onSelectThread={onSelectThread}
          threadSummaries={threadSummaries}
        />
      </Suspense>
      <div className="panel-title conversation-panel-title chat-shell-header">
        <div className="panel-title-main">
          <IconButton
            size="md"
            aria-expanded={historySidebarOpen}
            aria-label={historySidebarOpen ? copy.closeHistorySidebar : copy.openHistorySidebar}
            title={historySidebarOpen ? copy.closeHistorySidebar : copy.openHistorySidebar}
            onClick={onToggleHistorySidebar}
            className="chat-history-toggle"
          >
            <IconSidebarToggle size={18} strokeWidth={2} />
          </IconButton>
          <span className="conversation-panel-label" aria-hidden="true">
            {copy.chat}
          </span>
          <h2 className="visually-hidden">{copy.chat}</h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-label={copy.newChat}
          onClick={handleStartNewChat}
          disabled={isBusy}
          title={busyTask ? copy.waitForCurrentRun : copy.newChat}
          className="panel-title-action"
        >
          <IconNewChat size={16} strokeWidth={1.8} />
          {copy.newChat}
        </Button>
      </div>
      {sessionStripVisible ? (
        <div className="chat-session-strip" aria-label={copy.sessionState}>
          {sessionSummary ? (
            <span className={`chat-session-pill status-${sessionSummary.status}`}>
              {busyTask ? (
                <LoaderCircle className="chat-run-status-spinner" size={13} />
              ) : (
                <Activity size={13} />
              )}
              {formatSessionStatus(sessionSummary.status, copy)}
            </span>
          ) : null}
          {sessionSummary && sessionSummary.stepNumber > 0 ? (
            <span className="chat-session-pill">
              {copy.sessionStep(sessionSummary.stepNumber)}
            </span>
          ) : null}
          {visibleQueuedMessageCount > 0 ? (
            <span className="chat-session-pill queued">
              <MessageSquare size={13} />
              {copy.queuedMessages(visibleQueuedMessageCount)}
            </span>
          ) : null}
          {sessionSummary && sessionSummary.contextCompactedThroughStep > 0 ? (
            <span className="chat-session-pill compacted">
              <Layers3 size={13} />
              {copy.contextCompactedThroughStep(sessionSummary.contextCompactedThroughStep)}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="chat-stream"
        aria-label={copy.conversation}
        aria-live="off"
        onScroll={handleStreamScroll}
        ref={chatStreamRef}
        role="log"
      >
        {visibleItems.length === 0 && !pendingStep ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <MessageSquare size={22} aria-hidden="true" />
            </div>
            {!deviceConnected ? (
              <>
                <strong>{copy.chatEmptyNeedsDeviceTitle}</strong>
                <p className="chat-empty-body">{copy.chatEmptyNeedsDeviceBody}</p>
                {onConnectDevice ? (
                  <Button variant="secondary" size="sm" onClick={onConnectDevice}>
                    {copy.chatEmptyConnectDevice}
                  </Button>
                ) : null}
              </>
            ) : !hasModelConfig ? (
              <>
                <strong>{copy.chatEmptyNeedsModelTitle}</strong>
                <p className="chat-empty-body">{copy.chatEmptyNeedsModelBody}</p>
                {onConfigureModel ? (
                  <Button variant="primary" size="sm" onClick={onConfigureModel}>
                    {copy.chatEmptyConfigureModel}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <strong>{copy.chatEmptyReadyTitle}</strong>
                <p className="chat-empty-body">{copy.chatEmptyReadyBody}</p>
                <div className="chat-quick-starts" role="list">
                  {copy.quickStartPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="chat-quick-start"
                      role="listitem"
                      aria-label={copy.useExamplePrompt(prompt)}
                      onClick={() => onSubmitChatMessage(prompt)}
                      disabled={isBusy}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
        {hiddenItemCount > 0 && !showAllHistory ? (
          <button
            type="button"
            className="chat-load-earlier"
            onClick={() => {
              const stream = chatStreamRef.current
              restoreScrollHeightRef.current = stream?.scrollHeight ?? null
              shouldFollowOutputRef.current = false
              setShowAllHistory(true)
            }}
          >
            {copy.showEarlierMessages(hiddenItemCount)}
          </button>
        ) : null}
        {visibleItems.length > 0 ? (
          <div className="chat-stream-list">
            {visibleItems.map((item) => {
              if (item.type === 'message') {
                return <ChatMessageItem key={item.id} item={item} copy={copy} />
              }
              const isLatestRun =
                latestRunItem?.id === item.id && (!isBusy || hasActiveRunTurns)
              return (
                <div className="chat-stream-item" key={item.id}>
                  <Suspense fallback={<RunProgressFallback />}>
                    <RunProgressBlock
                      active={isBusy && isLatestRun}
                      onOpenRunLog={onOpenRunLog}
                      startedAt={isLatestRun ? sessionSummary?.runStartedAt : undefined}
                      finishedAt={isLatestRun ? sessionSummary?.runFinishedAt : undefined}
                      turns={item.turns}
                    />
                  </Suspense>
                </div>
              )
            })}
          </div>
        ) : null}
        <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {[
            busyTask?.label,
            sessionSummary
              ? `${formatSessionStatus(sessionSummary.status, copy)}${
                  sessionSummary.stepNumber > 0 ? ` ${copy.sessionStep(sessionSummary.stepNumber)}` : ''
                }`
              : null,
          ]
            .filter(Boolean)
            .join('. ')}
        </span>
        {isBusy && (!latestRunItem || !hasActiveRunTurns) ? (
          <Suspense fallback={<RunProgressFallback />}>
            <RunProgressPlaceholder startedAt={sessionSummary?.runStartedAt} />
          </Suspense>
        ) : null}
        {pendingStep ? (
          <PendingActionCard
            busyTask={busyTask}
            copy={copy}
            onExecutePendingStep={onExecutePendingStep}
            pendingStep={pendingStep}
          />
        ) : !isBusy && sessionSummary ? (
          <Suspense fallback={null}>
            <NeedsYouCard
              failureClass={sessionSummary.latestFailureClass}
              message={sessionSummary.latestStatusMessage}
              onAnswer={() => chatInputRef.current?.focus()}
              onContinue={onSubmitChatMessage}
              onOpenRunLog={onOpenRunLog}
              onResume={onResumeRun}
              status={sessionSummary.status}
              takeoverKind={sessionSummary.latestTakeoverKind}
              reviewKind={sessionSummary.latestReviewKind}
            />
          </Suspense>
        ) : null}
      </div>
      {showScrollToBottom ? (
        <IconButton
          size="md"
          aria-label={copy.scrollToLatest}
          title={copy.scrollToLatest}
          onClick={() => scrollToBottom()}
          className="chat-scroll-bottom"
        >
          <ArrowDown size={16} />
        </IconButton>
      ) : null}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          submitChatIfNotEmpty()
        }}
      >
        <div className="chat-input-frame" onClick={focusComposerShell}>
          <label className="chat-input-label" htmlFor={chatInputId}>
            <span className="visually-hidden">{copy.chatMessage}</span>
            <textarea
              id={chatInputId}
              autoComplete="off"
              ref={chatInputRef}
              className="chat-input"
              name="chatMessage"
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyDown={handleComposerKeyDown}
              rows={chatInputRows}
              placeholder={
                !deviceConnected
                  ? copy.chatPlaceholderNeedsDevice
                  : !hasModelConfig
                    ? copy.chatPlaceholderNeedsModel
                    : copy.chatPlaceholder
              }
            />
          </label>
          <div className="chat-input-actions">
            <span className="chat-input-action-spacer" aria-hidden="true" />
            {canStopRun ? (
              <>
                <IconButton
                  size="md"
                  variant="secondary"
                  disabled={runPausing}
                  onClick={onPauseRun}
                  title={runPausing ? copy.pauseRunPendingHint : copy.pauseRun}
                  aria-label={runPausing ? copy.pauseRunPending : copy.pauseRun}
                  className="chat-send chat-pause"
                >
                  {runPausing ? <LoaderCircle size={14} className="spin" /> : <Pause size={14} />}
                </IconButton>
                <IconButton
                  size="md"
                  variant="danger"
                  onClick={onStopRun}
                  title={copy.stopRun}
                  aria-label={copy.stopRun}
                  className="chat-send chat-stop"
                >
                  <IconStop size={14} />
                </IconButton>
              </>
            ) : (
              <IconButton
                size="md"
                variant="primary"
                type="submit"
                disabled={chatIsEmpty}
                title={chatIsEmpty ? copy.typeMessageFirst : copy.send}
                aria-label={copy.send}
                className="chat-send"
              >
                <Send size={16} />
              </IconButton>
            )}
          </div>
        </div>
      </form>
    </section>
  )
}

const ChatMessageItem = memo(function ChatMessageItem({
  item,
  copy,
}: {
  item: Extract<InteractionStreamItem, { type: 'message' }>
  copy: AppCopy
}) {
  return (
    <article className={`chat-message ${item.message.role} chat-stream-item`}>
      <span className="visually-hidden">
        {formatConversationRole(item.message.role, copy)}
      </span>
      <LazyMarkdownContent className="chat-message-content" content={item.message.content} />
    </article>
  )
})

function resizeComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`
}

function IconSidebarToggle({
  size,
  strokeWidth,
}: {
  size: number
  strokeWidth: number
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="20" y1="8" y2="8" />
      <line x1="4" x2="14" y1="16" y2="16" />
    </svg>
  )
}

function RunProgressFallback() {
  return (
    <div className="run-progress-block is-active run-progress-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  )
}

function shouldShowSessionSummary(summary: AgentSessionSummary) {
  return (
    summary.status !== 'idle' ||
    summary.stepNumber > 0 ||
    summary.pendingUserMessageCount > 0 ||
    summary.contextCompactedThroughStep > 0
  )
}

function formatSessionStatus(status: AgentSessionSummary['status'], copy: AppCopy) {
  switch (status) {
    case 'running':
      return copy.sessionStatusRunning
    case 'awaiting_review':
      return copy.sessionStatusAwaitingReview
    case 'awaiting_takeover':
      return copy.sessionStatusAwaitingTakeover
    case 'done':
      return copy.sessionStatusDone
    case 'paused':
      return copy.sessionStatusPaused
    case 'stopped':
      return copy.sessionStatusStopped
    case 'error':
      return copy.sessionStatusError
    case 'idle':
    default:
      return copy.sessionStatusIdle
  }
}

function messageToItem(message: AgentConversationMessage): InteractionStreamItem {
  return {
    type: 'message',
    id: `message-${message.id}`,
    message,
  }
}

function formatConversationRole(role: 'user' | 'assistant' | 'observation', copy: AppCopy) {
  if (role === 'assistant') {
    return copy.assistant
  }
  if (role === 'observation') {
    return copy.observation
  }
  return copy.user
}
