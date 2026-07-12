import type { AgentStep } from '../lib/agent'
import type { BusyTask } from '../lib/busyTask'
import type { InteractionStreamItem } from '../lib/interactionStream'
import type { AgentConversationMessage } from '../lib/openAiTypes'
import type { AgentThreadSummary } from '../lib/threadStore'
import type { AgentSessionSummary } from '../hooks/useAgentSessionHistory'
import { ChatPanel } from './ChatPanel'

export type ConversationPanelProps = {
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

export function ConversationPanel({
  activeThreadId,
  busyTask,
  conversation,
  deviceConnected,
  hasModelConfig,
  interactionItems,
  historySidebarOpen,
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
  pendingStep,
  queuedChatMessageCount,
  sessionSummary,
  threadSummaries,
}: ConversationPanelProps) {
  return (
    <aside className="panel conversation-panel">
      <ChatPanel
        activeThreadId={activeThreadId}
        busyTask={busyTask}
        conversation={conversation}
        deviceConnected={deviceConnected}
        hasModelConfig={hasModelConfig}
        interactionItems={interactionItems}
        historySidebarOpen={historySidebarOpen}
        queuedChatMessageCount={queuedChatMessageCount}
        sessionSummary={sessionSummary}
        threadSummaries={threadSummaries}
        onCloseHistorySidebar={onCloseHistorySidebar}
        onConfigureModel={onConfigureModel}
        onConnectDevice={onConnectDevice}
        onDeleteThread={onDeleteThread}
        onExecutePendingStep={onExecutePendingStep}
        onSelectThread={onSelectThread}
        onStartNewChat={onStartNewChat}
        onStopRun={onStopRun}
        onSubmitChatMessage={onSubmitChatMessage}
        onToggleHistorySidebar={onToggleHistorySidebar}
        pendingStep={pendingStep}
      />
    </aside>
  )
}
