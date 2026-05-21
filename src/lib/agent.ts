import type {
  DeviceBackend,
  DeviceScreenshot,
  DeviceState,
  ExecuteActionOptions,
} from '../adapters/deviceBackend'
import { type AgentAction, buildActionPreview, parseModelAction } from './actions'
import type {
  AgentConversationMessage,
  AgentHistoryItem,
  ModelConfig,
  OpenAiClient,
} from './openAiClient'
import type { PromptMode } from './prompts'
import { mapActionCoordinates, modelScreenshotView } from './screenshotCoordinates'

export type AgentTiming = {
  captureMs: number
  currentAppMs: number
  modelMs: number
  parseMs: number
  totalMs: number
}

export type AgentStep = {
  index: number
  screenshot: DeviceScreenshot
  currentApp: string
  deviceState: DeviceState
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  preview: string
  timing: AgentTiming
  executionResult?: string
}

export type RunAgentStepInput = {
  device: DeviceBackend
  client: OpenAiClient
  modelConfig: ModelConfig
  task: string
  promptMode: PromptMode
  session?: AgentSession
  index?: number
}

export type AgentRunStatus =
  | 'awaiting_review'
  | 'awaiting_takeover'
  | 'done'
  | 'loop_guard'
  | 'max_steps'
  | 'stopped'

export type AgentRunResult = {
  status: AgentRunStatus
  steps: AgentStep[]
  reason?: string
}

export type AgentRunnerInput = {
  modelConfig: ModelConfig
  task: string
  promptMode: PromptMode
  autoExecute: boolean
  maxSteps: number
  session?: AgentSession
  signal?: AbortSignal
  onStep?: (step: AgentStep) => void
  onExecuted?: (step: AgentStep, result: string) => void
  confirmSensitiveAction?: ExecuteActionOptions['confirmSensitiveAction']
}

export type AgentSession = {
  task: string
  history: AgentHistoryItem[]
  messages: AgentConversationMessage[]
  pendingUserMessages: QueuedUserMessage[]
  stepNumber: number
}

export type QueuedUserMessage = {
  id: string
  message: string
  queuedAtStep: number
}

export function createAgentSession(task: string): AgentSession {
  const initialTask = task.trim()
  return {
    task,
    history: [],
    messages: initialTask ? [createConversationMessage('user', initialTask)] : [],
    pendingUserMessages: [],
    stepNumber: 0,
  }
}

export function addUserMessage(session: AgentSession, message: string) {
  const content = message.trim()
  if (!content) {
    throw new Error('Cannot add an empty user message.')
  }
  const entry = createConversationMessage('user', content)
  session.messages.push(entry)
  if (!session.task.trim()) {
    session.task = content
  }
  return entry
}

export function queueUserMessage(session: AgentSession, message: string): QueuedUserMessage {
  const entry = addUserMessage(session, message)
  const queued = {
    id: entry.id,
    message: entry.content,
    queuedAtStep: session.stepNumber,
  }
  session.pendingUserMessages.push(queued)
  return queued
}

export function recordAgentStep(session: AgentSession, step: AgentStep, executionResult?: string) {
  step.executionResult = executionResult
  session.history.push({
    step: step.index,
    currentApp: step.currentApp,
    actionPreview: step.preview,
    executionResult,
  })
  if (executionResult) {
    session.messages.push(createConversationMessage('observation', executionResult))
  }
}

export async function runAgentStep({
  device,
  client,
  modelConfig,
  task,
  promptMode,
  session,
  index = 1,
}: RunAgentStepInput): Promise<AgentStep> {
  const startedAt = now()
  const captureStartedAt = now()
  const screenshot = await device.screenshot()
  const captureMs = elapsed(captureStartedAt)
  const currentAppStartedAt = now()
  const deviceState = await getDeviceStateOrUnknown(device)
  const currentApp = deviceState.app
  const currentAppMs = elapsed(currentAppStartedAt)
  const modelStartedAt = now()
  const modelScreenshot = modelScreenshotView(screenshot)
  if (session) {
    session.stepNumber = index
    drainPendingUserMessages(session)
  }
  const modelOutput = await client.completeAction({
    ...modelConfig,
    task,
    conversation: session?.messages,
    screenshotDataUrl: modelScreenshot.dataUrl,
    screen: modelScreenshot.screen,
    deviceScreen: screenshot.screen,
    currentApp,
    deviceState,
    history: session?.history ?? [],
    promptMode,
  })
  if (session) {
    session.messages.push(createConversationMessage('assistant', modelOutput))
  }
  const modelMs = elapsed(modelStartedAt)
  const parseStartedAt = now()
  const action = parseModelAction(modelOutput, modelScreenshot.screen)
  const executionAction = mapActionCoordinates(action, modelScreenshot.screen, screenshot.screen)
  const parseMs = elapsed(parseStartedAt)

  return {
    index,
    screenshot,
    currentApp,
    deviceState,
    modelOutput,
    action,
    executionAction,
    preview: buildActionPreview(action),
    timing: {
      captureMs,
      currentAppMs,
      modelMs,
      parseMs,
      totalMs: elapsed(startedAt),
    },
  }
}

export function createAgentRunner({
  device,
  client,
}: {
  device: DeviceBackend
  client: OpenAiClient
}) {
  return {
    async run(input: AgentRunnerInput): Promise<AgentRunResult> {
      const steps: AgentStep[] = []
      const session = input.session ?? createAgentSession(input.task)

      for (let index = 1; index <= input.maxSteps; index += 1) {
        if (input.signal?.aborted) {
          return { status: 'stopped', steps }
        }

        const step = await runAgentStep({
          device,
          client,
          modelConfig: input.modelConfig,
          task: input.task,
          promptMode: input.promptMode,
          session,
          index,
        })
        steps.push(step)
        input.onStep?.(step)

        if (step.action.action === 'done') {
          recordAgentStep(session, step)
          if (session.pendingUserMessages.length > 0) {
            continue
          }
          return { status: 'done', steps }
        }

        if (step.action.action === 'take_over') {
          recordAgentStep(session, step)
          return { status: 'awaiting_takeover', steps }
        }

        const loopSignal = detectLoopGuard(session, step)
        if (loopSignal) {
          recordAgentStep(session, step, loopSignal)
          return { status: 'loop_guard', steps, reason: loopSignal }
        }

        if (!input.autoExecute) {
          return { status: 'awaiting_review', steps }
        }

        const result = await device.execute(step.executionAction, {
          confirmSensitiveAction: input.confirmSensitiveAction,
        })
        recordAgentStep(session, step, result)
        input.onExecuted?.(step, result)
      }

      return { status: 'max_steps', steps }
    },
  }
}

function drainPendingUserMessages(session: AgentSession) {
  if (session.pendingUserMessages.length === 0) {
    return []
  }
  const messages = [...session.pendingUserMessages]
  session.pendingUserMessages = []
  return messages
}

function createConversationMessage(
  role: AgentConversationMessage['role'],
  content: string,
): AgentConversationMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
  }
}

function now() {
  return performance.now()
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt)
}

function detectLoopGuard(session: AgentSession, step: AgentStep) {
  const repeatedPreviewCount = countConsecutive(
    session.history,
    (item) => item.actionPreview === step.preview,
  )
  if (repeatedPreviewCount >= 3) {
    return `Stopped before repeating "${step.preview}" a fourth time.`
  }

  if (step.action.action === 'wait') {
    const waitCount = countConsecutive(session.history, (item) =>
      item.actionPreview.startsWith('wait '),
    )
    if (waitCount >= 3) {
      return 'Stopped before executing a fourth consecutive wait action.'
    }
  }

  return null
}

function countConsecutive(
  history: readonly AgentHistoryItem[],
  predicate: (item: AgentHistoryItem) => boolean,
) {
  let count = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!predicate(history[index])) {
      break
    }
    count += 1
  }
  return count
}

async function getDeviceStateOrUnknown(device: DeviceBackend): Promise<DeviceState> {
  try {
    return await device.getDeviceState()
  } catch {
    return { app: 'Unknown' }
  }
}
