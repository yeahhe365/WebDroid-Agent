// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceScreenshot } from '../adapters/deviceTypes'
import type { AgentStep } from '../lib/agent'
import type { AgentAction } from '../lib/actionTypes'
import { APP_COPY } from '../lib/appCopy'
import {
  createAgentThread,
  recordThreadTurnExecution,
  startThreadTurn,
} from '../lib/agentThread'
import { buildInteractionStream } from '../lib/interactionStream'
import { ConversationPanel } from './ConversationPanel'
import { AppProvider } from './AppContext'

const screenshot: DeviceScreenshot = {
  bytes: new Uint8Array([1, 2, 3]),
  dataUrl: 'data:image/png;base64,abc',
  screen: { width: 1080, height: 2400 },
}
const agentStepCardCss = readFileSync('src/styles/agent-step-card.css', 'utf8')
const chatComposerCss = readFileSync('src/styles/chat-composer.css', 'utf8')
const chatPanelCss = readFileSync('src/styles/chat-panel.css', 'utf8')
const chatHistoryCss = readFileSync('src/styles/chat-history.css', 'utf8')
const conversationPanelCss = readFileSync('src/styles/conversation-panel.css', 'utf8')

function renderConversationPanel(
  overrides: Partial<Parameters<typeof ConversationPanel>[0]> = {},
) {
  const props: Parameters<typeof ConversationPanel>[0] = {
    activeThreadId: 'thread-current',
    busyTask: null,
    conversation: [],
    historySidebarOpen: false,
    onCloseHistorySidebar: vi.fn(),
    onDeleteThread: vi.fn(),
    onExecutePendingStep: vi.fn(),
    onOpenRunLog: vi.fn(),
    onPauseRun: vi.fn(),
    onResumeRun: vi.fn(),
    onSelectThread: vi.fn(),
    onStartNewChat: vi.fn(),
    onStopRun: vi.fn(),
    onSubmitChatMessage: vi.fn(),
    onToggleHistorySidebar: vi.fn(),
    pendingStep: null,
    queuedChatMessageCount: 0,
    threadSummaries: [],
    ...overrides,
  }

  return render(
    <AppProvider value={{ copy: APP_COPY['en-US'], locale: 'en-US' }}>
      <ConversationPanel {...props} />
    </AppProvider>,
  )
}

describe('ConversationPanel', () => {
  beforeEach(() => {
    // ponytail: jsdom's window.confirm returns undefined (falsy); delete-flow tests need true.
    vi.stubGlobal('confirm', () => true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('keeps the chat composer in the chat region without advanced debug controls', () => {
    renderConversationPanel()

    const title = screen.getByRole('heading', { name: 'Chat' }).closest('.panel-title')
    expect(title).toBeTruthy()
    const historyToggle = within(title as HTMLElement).getByRole('button', {
      name: /open history sidebar/i,
    })
    const toggleIcon = historyToggle.querySelector('svg')
    expect(historyToggle.className).toContain('chat-history-toggle')
    expect(historyToggle.className).toContain('icon-button')
    expect(toggleIcon?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(toggleIcon?.querySelectorAll('line')).toHaveLength(2)
    expect(toggleIcon?.querySelector('line[x1="4"][x2="20"][y1="8"][y2="8"]')).toBeTruthy()
    expect(
      toggleIcon?.querySelector('line[x1="4"][x2="14"][y1="16"][y2="16"]'),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Chat' }).className).toContain('visually-hidden')
    expect((title as HTMLElement).querySelector('.panel-title-main > svg')).toBeNull()
    expect(within(title as HTMLElement).getByRole('button', { name: /new chat/i })).toBeTruthy()

    const sendButton = screen.getByRole('button', { name: /^send$/i })
    expect(sendButton.closest('.chat-composer')).toBeTruthy()
    expect(sendButton.closest('.chat-input-actions')).toBeTruthy()
    expect(document.querySelector('.chat-empty')).toBeNull()
    expect(screen.queryByText('Advanced/debug')).toBeNull()
    expect(screen.queryByRole('button', { name: /plan next step/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /run agent/i })).toBeNull()
  })

  it('shows pause and stop controls while a run is active', () => {
    const onPauseRun = vi.fn()
    const onStopRun = vi.fn()
    renderConversationPanel({
      busyTask: { id: 'run-agent', label: 'Run agent', startedAt: 1000 },
      onPauseRun,
      onStopRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pause run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    expect(onPauseRun).toHaveBeenCalledTimes(1)
    expect(onStopRun).toHaveBeenCalledTimes(1)
  })

  it('opens the AMC-style chat history sidebar and routes history actions', async () => {
    const onCloseHistorySidebar = vi.fn()
    const onDeleteThread = vi.fn()
    const onSelectThread = vi.fn()
    const onStartNewChat = vi.fn()
    renderConversationPanel({
      activeThreadId: 'thread-2',
      historySidebarOpen: true,
      onCloseHistorySidebar,
      onDeleteThread,
      onSelectThread,
      onStartNewChat,
      threadSummaries: [
        {
          id: 'thread-2',
          title: 'Second task',
          task: 'Second task',
          status: 'idle',
          createdAt: 2000,
          updatedAt: 2000,
        },
        {
          id: 'thread-1',
          title: 'First task',
          task: 'First task',
          status: 'idle',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    })

    const sidebar = await screen.findByRole('complementary', { name: /history/i })
    expect(sidebar).toBeTruthy()
    expect(sidebar.querySelector('.chat-history-count')?.textContent).toBe('2')
    expect(sidebar.querySelectorAll('.chat-history-status-dot')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /recent chats/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /open chat second task/i }).getAttribute('aria-current')).toBe('page')

    fireEvent.change(screen.getByRole('textbox', { name: /search chat history/i }), {
      target: { value: 'first' },
    })
    fireEvent.click(screen.getByRole('button', { name: /open chat first task/i }))
    expect(onSelectThread).toHaveBeenCalledWith('thread-1')

    fireEvent.click(screen.getByRole('button', { name: /delete chat first task/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDeleteThread).toHaveBeenCalledWith('thread-1')

    fireEvent.click(within(sidebar).getByRole('button', { name: /^new chat$/i }))
    expect(onStartNewChat).toHaveBeenCalledTimes(1)
    expect(onCloseHistorySidebar).toHaveBeenCalledTimes(1)
  })

  it('shows the searched term in the chat history empty state and clears it', async () => {
    renderConversationPanel({
      historySidebarOpen: true,
      threadSummaries: [
        {
          id: 'thread-1',
          title: 'Open Wi-Fi',
          task: 'Open Wi-Fi',
          status: 'idle',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    })

    const search = await screen.findByRole('textbox', { name: /search chat history/i })
    fireEvent.change(search, { target: { value: 'billing' } })

    await waitFor(() =>
      expect(screen.getByText('No chats match "billing"')).toBeTruthy(),
    )
    expect(screen.queryByRole('button', { name: /open chat open wi-fi/i })).toBeNull()

    fireEvent.click(screen.getByText('Clear history search'))

    expect((search as HTMLInputElement).value).toBe('')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /open chat open wi-fi/i })).toBeTruthy(),
    )
    expect(screen.queryByText('No chats match "billing"')).toBeNull()
  })

  it('returns focus to the chat input after starting a new chat', () => {
    const onStartNewChat = vi.fn()
    renderConversationPanel({ onStartNewChat })

    const newChatButton = screen.getByRole('button', { name: /new chat/i })
    const input = screen.getByRole('textbox', { name: /chat message/i })

    newChatButton.focus()
    expect(document.activeElement).toBe(newChatButton)

    fireEvent.click(newChatButton)

    expect(onStartNewChat).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
  })

  it('renders the conversation as a persistent chat stream with a bottom composer', () => {
    renderConversationPanel({
      conversation: [
        { id: 'u1', role: 'user', content: 'Open Settings.' },
        { id: 'o1', role: 'observation', content: 'Current app: Settings.' },
        { id: 'a1', role: 'assistant', content: 'Done.' },
      ],
    })

    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull()

    const chatShell = document.querySelector('.chat-shell')
    const chatStream = document.querySelector('.chat-stream')
    const composer = document.querySelector('.chat-composer')

    expect(chatShell).toBeTruthy()
    expect(chatStream).toBeTruthy()
    expect(composer).toBeTruthy()
    expect(chatShell?.contains(chatStream)).toBe(true)
    expect(chatShell?.contains(composer)).toBe(true)
    expect(within(chatStream as HTMLElement).getByText('Open Settings.')).toBeTruthy()
    expect(within(chatStream as HTMLElement).getByText('Current app: Settings.')).toBeTruthy()
    expect(within(chatStream as HTMLElement).getByText('Done.')).toBeTruthy()
    expect(composer?.compareDocumentPosition(chatStream as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it('uses the AMC-style chat input shell', () => {
    expect(chatComposerCss).toMatch(/\.chat-composer\s*\{[\s\S]*position:\s*relative/)
    expect(chatComposerCss).not.toMatch(/\.chat-composer\s*\{[\s\S]*position:\s*absolute/)
    expect(chatComposerCss).not.toMatch(/\.chat-composer\s*\{[\s\S]*pointer-events:\s*none/)
    expect(chatComposerCss).toMatch(
      /\.chat-input-frame\s*\{[\s\S]*background:\s*var\(--field-bg\)/,
    )
    expect(chatComposerCss).toMatch(
      /\.chat-input-frame\s*\{[\s\S]*border-radius:\s*(20px|var\(--radius-xl\))/,
    )
    expect(chatComposerCss).toMatch(
      /\.chat-input-frame\s*\{[\s\S]*display:\s*flex/,
    )
    expect(chatComposerCss).toMatch(
      /\.chat-input-frame\s*\{[\s\S]*flex-direction:\s*column/,
    )
    expect(chatComposerCss).toMatch(
      /\.chat-input-frame:focus-within\s*\{[\s\S]*border-color:\s*var\(--accent-soft-border\)/,
    )
    expect(chatComposerCss).toMatch(/\.chat-input\s*\{[\s\S]*min-height:\s*24px/)
    expect(chatComposerCss).toMatch(/\.chat-input\s*\{[\s\S]*border-radius:\s*0/)
    expect(chatComposerCss).toMatch(
      /\.chat-input:focus,\s*[\r\n]+\.chat-input:focus-visible\s*\{[\s\S]*box-shadow:\s*none/,
    )
    expect(chatComposerCss).toMatch(/\.chat-send\s*\{[\s\S]*height:\s*38px/)
    expect(chatComposerCss).not.toContain('backdrop-filter')
  })

  it('renders chat messages as sanitized markdown', async () => {
    renderConversationPanel({
      conversation: [
        {
          id: 'a1',
          role: 'assistant',
          content: '## Result\n\n- **Done**\n\n[Docs](https://example.com)\n\n<script>alert(1)</script>',
        },
      ],
    })

    const chatStream = screen.getByLabelText('Conversation')
    const heading = await within(chatStream).findByRole('heading', { name: 'Result' })
    const strong = within(chatStream).getByText('Done')
    const link = within(chatStream).getByRole('link', { name: 'Docs' })

    expect(heading.tagName).toBe('H2')
    expect(strong.tagName).toBe('STRONG')
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(chatStream.querySelector('script')).toBeNull()
  })

  it('renders agent steps with their execution result in the chat stream', async () => {
    const thread = createAgentThread('Open Wi-Fi settings', { now: 1000 })
    const action: AgentAction = { action: 'tap', x: 120, y: 240, reason: 'open Wi-Fi' }
    const turn = startThreadTurn(thread, {
      id: 'turn-1',
      index: 1,
      task: 'Open Wi-Fi settings',
      latestUserMessage: 'Open Wi-Fi settings',
      promptContext: 'Task: Open Wi-Fi settings',
      modelOutput: '{"action":"tap","x":120,"y":240}',
      action,
      executionAction: action,
      preview: 'tap (120, 240) - open Wi-Fi',
      deviceSnapshot: {
        currentApp: 'Settings',
        deviceState: { app: 'Settings', packageName: 'com.android.settings' },
        screenshot,
      },
      timing: {
        captureMs: 1,
        currentAppMs: 2,
        executionMs: 890,
        modelMs: 3,
        parseMs: 4,
        totalMs: 2010,
      },
      now: 1100,
    })
    recordThreadTurnExecution(thread, turn.id, {
      executionResult: 'input tap 120 240',
      toolName: 'tap',
      success: true,
      now: 1200,
    })

    renderConversationPanel({
      busyTask: { id: 'run-agent', label: 'Run agent', startedAt: 1000 },
      conversation: thread.messages,
      interactionItems: buildInteractionStream(thread),
      sessionSummary: {
        status: 'running',
        stepNumber: 1,
        turnCount: 1,
        pendingUserMessageCount: 0,
        contextCompactedThroughStep: 0,
        runStartedAt: 1000,
        runStepCount: 1,
        updatedAt: 1200,
      },
    })

    const chatStream = screen.getByLabelText('Conversation')
    const step = await within(chatStream).findByLabelText('Step 1: Tap')

    expect(within(step).getByText('Tap')).toBeTruthy()
    expect(within(step).getByText('#1')).toBeTruthy()
    expect(within(step).getByText('Executed')).toBeTruthy()
    expect(step.querySelector('.run-progress-step-time')).toBeTruthy()
    expect(within(step).getByText('2 s')).toBeTruthy()
    expect(within(step).queryByText('Settings')).toBeNull()
    expect(within(step).queryByText('tap')).toBeNull()
    expect(within(step).queryByText('input tap 120 240')).toBeNull()
    fireEvent.click(step)
    const stepRow = step.closest('.run-progress-step') as HTMLElement
    expect(within(stepRow).getByText('Result')).toBeTruthy()
    expect(within(stepRow).getByText('Tool')).toBeTruthy()
    expect(within(stepRow).getByText('App')).toBeTruthy()
    expect(within(stepRow).getByText('Model output')).toBeTruthy()
    expect(within(stepRow).getByText('Settings')).toBeTruthy()
    expect(within(stepRow).getByText('tap')).toBeTruthy()
    expect(within(stepRow).getByText('tap (120, 240) - open Wi-Fi')).toBeTruthy()
    expect(within(stepRow).getByText('input tap 120 240')).toBeTruthy()
    expect(within(chatStream).queryAllByText('input tap 120 240')).toHaveLength(1)
  })

  it('stretches action cards across the chat stream', () => {
    expect(agentStepCardCss).toMatch(/\.agent-step-card\s*\{[^}]*justify-self:\s*stretch/)
    expect(agentStepCardCss).toMatch(/\.agent-step-card\s*\{[^}]*width:\s*100%/)
    expect(agentStepCardCss).not.toMatch(/\.agent-step-card\s*\{[^}]*width:\s*fit-content/)
    expect(conversationPanelCss).toMatch(
      /\.chat-stream\s*>\s*\.pending-action\s*\{[^}]*width:\s*100%/,
    )
  })

  it('styles the chat sidebar toggle like AMC', () => {
    expect(chatHistoryCss).toMatch(/\.chat-history-toggle\s*\{[^}]*background:\s*transparent/)
    expect(chatHistoryCss).toMatch(/\.chat-history-toggle\s*\{[^}]*border-radius:\s*var\(--radius-md\)/)
    expect(chatHistoryCss).toMatch(/\.chat-history-toggle\s*\{[^}]*height:\s*34px/)
    expect(chatHistoryCss).toMatch(/\.chat-history-toggle\s*\{[^}]*width:\s*34px/)
    expect(chatHistoryCss).toMatch(
      /\.chat-history-toggle\s*\{[^}]*transition:\s*[^}]*color/,
    )
  })

  it('renders the structured takeover kind as the matching card', async () => {
    renderConversationPanel({
      sessionSummary: {
        status: 'awaiting_takeover',
        stepNumber: 1,
        turnCount: 1,
        pendingUserMessageCount: 0,
        contextCompactedThroughStep: 0,
        latestStatusMessage: 'Please complete the captcha.',
        latestTakeoverKind: 'login',
        runStepCount: 1,
        updatedAt: 2000,
      },
    })

    expect(
      await screen.findByRole('heading', { name: 'Sign in to continue' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Complete the verification' })).toBeNull()
  })

  it('resumes a paused run from the needs-you card', async () => {
    const onResumeRun = vi.fn()
    renderConversationPanel({
      onResumeRun,
      sessionSummary: {
        status: 'paused',
        stepNumber: 1,
        turnCount: 1,
        pendingUserMessageCount: 0,
        contextCompactedThroughStep: 0,
        latestStatusMessage: 'Run paused',
        runStepCount: 1,
        updatedAt: 2000,
      },
    })

    expect(await screen.findByRole('heading', { name: 'Paused' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume run' }))
    expect(onResumeRun).toHaveBeenCalledTimes(1)
  })

  it('draws a subtle divider below the chat header', () => {
    expect(chatPanelCss).toMatch(/\.chat-shell-header\s*\{[^}]*border-bottom/)
  })

  it('submits chat with Enter while keeping Shift Enter for multiline input', () => {
    const onSubmitChatMessage = vi.fn()
    renderConversationPanel({
      onSubmitChatMessage,
    })

    const input = screen.getByRole('textbox', { name: /chat message/i })
    fireEvent.change(input, { target: { value: 'Open Wi-Fi settings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmitChatMessage).toHaveBeenCalledTimes(1)
    expect(onSubmitChatMessage).toHaveBeenCalledWith('Open Wi-Fi settings')

    fireEvent.change(input, { target: { value: 'Another line' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmitChatMessage).toHaveBeenCalledTimes(1)
  })

  it('shows a stop button in the send position while the agent run is active', () => {
    const onStopRun = vi.fn()
    const onSubmitChatMessage = vi.fn()
    renderConversationPanel({
      busyTask: { id: 'run-agent', label: 'Run agent', startedAt: 1000 },
      onStopRun,
      onSubmitChatMessage,
    })

    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull()

    const stopButton = screen.getByRole('button', { name: /^stop run$/i })
    expect(stopButton.closest('.chat-composer')).toBeTruthy()
    fireEvent.click(stopButton)

    expect(onStopRun).toHaveBeenCalledTimes(1)
    expect(onSubmitChatMessage).not.toHaveBeenCalled()
  })

  it('shows run status and reveals a latest-message control when scrolled away from bottom', () => {
    renderConversationPanel({
      busyTask: { id: 'run-agent', label: 'Run agent', startedAt: 1000 },
      conversation: [
        { id: 'u1', role: 'user', content: 'Open Settings.' },
        { id: 'o1', role: 'observation', content: 'Captured current screen.' },
      ],
    })

    const chatStream = screen.getByLabelText('Conversation')
    Object.defineProperty(chatStream, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(chatStream, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(chatStream, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })
    fireEvent.scroll(chatStream)

    expect(screen.getByRole('status').textContent).toContain('Run agent')
    expect(screen.getByRole('button', { name: /scroll to latest/i })).toBeTruthy()
  })

  it('offers an explicit way to reveal messages hidden by the render cap', () => {
    const conversation = Array.from({ length: 165 }, (_, index) => ({
      id: `message-${index}`,
      role: 'user' as const,
      content: `Message ${index}`,
    }))

    renderConversationPanel({ conversation })

    const loadEarlier = screen.getByRole('button', { name: /show 5 earlier messages/i })
    expect(screen.queryByText('Message 0')).toBeNull()

    fireEvent.click(loadEarlier)
    expect(screen.getByText('Message 0')).toBeTruthy()
  })

  it('explains disabled chat without showing advanced run actions or an inert execute button', () => {
    renderConversationPanel()

    expect(screen.getByRole('button', { name: /^send$/i }).getAttribute('title')).toBe(
      'Type a message first.',
    )
    expect(screen.queryByText('Advanced/debug')).toBeNull()
    expect(screen.queryByRole('button', { name: /plan next step/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /run agent/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^execute$/i })).toBeNull()
  })

  it('does not keep max steps in the conversation panel after moving it to settings', () => {
    renderConversationPanel()

    expect(screen.queryByLabelText(/max steps/i)).toBeNull()
  })

  it('does not render task template controls', () => {
    renderConversationPanel()

    expect(screen.queryByText('Task template')).toBeNull()
    expect(screen.queryByLabelText(/task template/i)).toBeNull()
  })

  it('hides the pending action panel when there is no pending step', () => {
    renderConversationPanel({ pendingStep: null })

    expect(document.querySelector('.pending-action')).toBeNull()
    expect(screen.queryByText('Pending action')).toBeNull()
    expect(screen.queryByText('None')).toBeNull()
  })

  it('keeps the pending action panel for a real pending step', () => {
    const pendingStep = {
      index: 2,
      action: {
        action: 'tap',
        x: 120,
        y: 240,
        reason: 'open Wi-Fi',
      },
      preview: 'tap at 120, 240 - open Wi-Fi',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    } as AgentStep

    renderConversationPanel({ pendingStep })

    const pendingAction = document.querySelector('.pending-action')
    const chatStream = document.querySelector('.chat-stream')
    expect(pendingAction).toBeTruthy()
    expect(pendingAction?.tagName).toBe('ARTICLE')
    expect(pendingAction?.getAttribute('aria-label')).toBe('Pending action: Tap')
    expect(pendingAction?.parentElement).toBe(chatStream)
    expect(pendingAction?.querySelector('.agent-step-action-icon.pending-action-icon svg')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('Pending action')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('Step 2')).toBeTruthy()
    expect(pendingAction?.querySelector('.pending-action-meta')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('10 ms')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('tap')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).queryByText('Total 10 ms')).toBeNull()
    expect(within(pendingAction as HTMLElement).getByText('Tap')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).getByText('open Wi-Fi')).toBeTruthy()
    expect(within(pendingAction as HTMLElement).queryByText('tap (120, 240)')).toBeNull()
    expect(pendingAction?.querySelector('.pending-action-preview')).toBeTruthy()
    expect(
      within(pendingAction as HTMLElement).getByRole('button', { name: /^execute$/i }),
    ).toBeTruthy()
  })

  it('shows only the nested reason for detailed pending repeat actions', () => {
    const pendingStep = {
      index: 52,
      action: {
        action: 'repeat',
        count: 10,
        actionToRepeat: {
          action: 'swipe',
          fromX: 350,
          fromY: 520,
          toX: 350,
          toY: 1260,
          durationMs: 400,
          reason: '当前商品列表已到底部，按用户要求在广告/逛街任务期间反向持续滑动保持活跃并继续累计金币',
        },
        delayMs: 1000,
      },
      preview:
        'repeat 10x swipe (350, 520) -> (350, 1260), 400ms, 1000ms delay - 当前商品列表已到底部，按用户要求在广告/逛街任务期间反向持续滑动保持活跃并继续累计金币',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    } as AgentStep

    renderConversationPanel({ pendingStep })

    const pendingAction = document.querySelector('.pending-action') as HTMLElement

    expect(within(pendingAction).getByText('Repeat')).toBeTruthy()
    expect(
      within(pendingAction).getByText(
        '当前商品列表已到底部，按用户要求在广告/逛街任务期间反向持续滑动保持活跃并继续累计金币',
      ),
    ).toBeTruthy()
    expect(within(pendingAction).queryByText(/repeat 10x swipe/)).toBeNull()
  })
})
