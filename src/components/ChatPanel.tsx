import {
  Activity,
  ArrowDown,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Send,
} from 'lucide-react'
import { IconNewChat, IconStop } from './icons'
import {
  memo,
  useEffect,
  useId,
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
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import type { InteractionStreamItem } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { AgentThreadSummary } from '../lib/threadStore'
import { useAppCopy } from './AppContext'
import { AgentStepCard } from './AgentStepCard'
import { Button, IconButton } from './primitives'
import { ChatHistorySidebar } from './ChatHistorySidebar'
import { LazyMarkdownContent } from './LazyMarkdownContent'
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
  onSelectThread: (threadId: string) => void
  onStartNewChat: () => void
  onStopRun: () => void
  onSubmitChatMessage: (message: string) => void
  onToggleHistorySidebar: () => void
}

const MAX_RENDERED_CHAT_ITEMS = 160
const CHAT_ITEM_ESTIMATE_PX = 148

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
  onSelectThread,
  onStartNewChat,
  onStopRun,
  onSubmitChatMessage,
  onToggleHistorySidebar,
  sessionSummary,
  queuedChatMessageCount,
}: ChatPanelProps) {
  const copy = useAppCopy()
  const chatInputId = useId()
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatStreamRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowOutputRef = useRef(true)
  const [composerThreadId, setComposerThreadId] = useState(activeThreadId)
  const [chatInput, setChatInput] = useState('')
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  // Reset the draft when the active thread changes (new chat / history restore).
  if (composerThreadId !== activeThreadId) {
    setComposerThreadId(activeThreadId)
    setChatInput('')
  }
  const chatIsEmpty = chatInput.trim().length === 0
  const isBusy = Boolean(busyTask)
  const canStopRun = busyTask?.id === 'run-agent'
  const items =
    interactionItems ?? conversation.map<InteractionStreamItem>((message) => messageToItem(message))
  const visibleItems = useMemo(
    () => items.slice(Math.max(0, items.length - MAX_RENDERED_CHAT_ITEMS)),
    [items],
  )
  const activeStepId = isAgentStepBusyTask(busyTask) ? findLatestOpenStepId(visibleItems) : null
  const chatInputRows = Math.min(6, Math.max(1, chatInput.split('\n').length))
  const visibleQueuedMessageCount =
    queuedChatMessageCount + (sessionSummary?.pendingUserMessageCount ?? 0)
  const sessionStripVisible =
    Boolean(busyTask) ||
    visibleQueuedMessageCount > 0 ||
    Boolean(sessionSummary && shouldShowSessionSummary(sessionSummary))
  const virtual = useVirtualWindow(visibleItems.length, {
    estimateHeight: CHAT_ITEM_ESTIMATE_PX,
    overscan: 5,
  })

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
    virtual.onScroll(event)
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
  }, [visibleItems.length, busyTask?.id, pendingStep?.index])

  const windowedItems = visibleItems.slice(virtual.startIndex, virtual.endIndex)
  const trailingSpacer =
    Math.max(0, visibleItems.length - virtual.endIndex) * CHAT_ITEM_ESTIMATE_PX

  return (
    <section className="chat-shell" aria-label={copy.chat}>
      {historySidebarOpen ? (
        <button
          type="button"
          className="chat-history-backdrop"
          aria-label={copy.closeHistorySidebar}
          onClick={onCloseHistorySidebar}
        />
      ) : null}
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
          {sessionSummary?.latestStatusMessage ? (
            <span className="chat-session-message" title={sessionSummary.latestStatusMessage}>
              {sessionSummary.latestStatusMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="chat-stream"
        aria-label={copy.conversation}
        aria-live="polite"
        aria-relevant="additions text"
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
                  <Button variant="primary" size="sm" onClick={onConnectDevice}>
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
        {visibleItems.length > 0 ? (
          <div
            className="chat-stream-virtual"
            style={{ height: virtual.totalHeight, position: 'relative' }}
          >
            <div
              className="chat-stream-window"
              style={{
                display: 'grid',
                gap: 'var(--space-4)',
                paddingTop: virtual.offsetTop,
                paddingBottom: trailingSpacer,
              }}
            >
              {windowedItems.map((item) =>
                item.type === 'step' ? (
                  <div className="chat-stream-item" key={item.id}>
                    <AgentStepCard
                      isActive={item.turn.id === activeStepId}
                      turn={item.turn}
                    />
                  </div>
                ) : (
                  <ChatMessageItem key={item.id} item={item} copy={copy} />
                ),
              )}
            </div>
          </div>
        ) : null}
        {isBusy ? (
          <div className="chat-run-status" role="status">
            <LoaderCircle className="chat-run-status-spinner" size={14} />
            <span>{busyTask?.label ?? copy.runAgentTask}</span>
          </div>
        ) : null}
        {pendingStep ? (
          <PendingActionCard
            busyTask={busyTask}
            copy={copy}
            onExecutePendingStep={onExecutePendingStep}
            pendingStep={pendingStep}
          />
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
              placeholder={copy.chatPlaceholder}
            />
          </label>
          <div className="chat-input-actions">
            <span className="chat-input-action-spacer" aria-hidden="true" />
            {canStopRun ? (
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

function findLatestOpenStepId(items: readonly InteractionStreamItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.type === 'step' && !item.turn.completedAt) {
      return item.turn.id
    }
  }
  return null
}

function isAgentStepBusyTask(busyTask: BusyTask | null) {
  return busyTask?.id === 'execute-action' || busyTask?.id === 'run-agent'
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
