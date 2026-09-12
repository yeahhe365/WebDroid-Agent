import type { DeviceScreenshot, DeviceState } from '../adapters/deviceTypes'
import { buildActionPreview } from './actionPreview'
import type { ScreenSize } from './actionTypes'
import type { AgentStep } from './agent'
import { formatDeviceState } from './deviceState'
import type { FailureClass } from './failureTaxonomy'
import { modelScreenshotView } from './screenshot'
import { truncateOptionalRetainedText, truncateRetainedText } from './textRetention'

export const MAX_RUN_LOG_DETAIL_CHARS = 6000
export const MAX_RUN_LOG_TIMELINE_FIELD_CHARS = 4000

export type LogScreenshot = {
  dataUrl: string
  screen: ScreenSize
}

export type LogEntry = {
  id: number
  time: string
  tone: 'info' | 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  screenshot?: LogScreenshot
  timeline?: {
    step?: number
    currentApp?: string
    packageName?: string
    toolName?: string
    /** Machine-readable failure class, when the step recorded one. */
    failureClass?: FailureClass
    modelOutput?: string
    actionPreview?: string
    executionActionPreview?: string
    executionResult?: string
  }
}

export type LogEntryInput = Omit<LogEntry, 'id' | 'time'>

export function createRunLogEntry(
  entry: LogEntryInput,
  date = new Date(),
  id = date.getTime() + Math.random(),
): LogEntry {
  return {
    ...compactRunLogEntryInput(entry),
    id,
    time: new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
  }
}

export function formatScreenCaptureDetail(
  screenshot: DeviceScreenshot,
  deviceState: DeviceState,
) {
  const screenshotSize = `${screenshot.screen.width}x${screenshot.screen.height}`
  return [screenshotSize, formatDeviceState(deviceState)].join('\n')
}

export function formatAgentStepDetail(step: AgentStep) {
  const timingDetail = [
    `capture ${step.timing.captureMs}ms`,
    `app ${step.timing.currentAppMs}ms`,
    `model ${step.timing.modelMs}ms`,
    `parse ${step.timing.parseMs}ms`,
    step.timing.executionMs === undefined ? null : `execution ${step.timing.executionMs}ms`,
    `total ${step.timing.totalMs}ms`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')

  return [
    `Current app: ${step.currentApp}`,
    step.toolName ? `Tool: ${step.toolName}` : null,
    `Timing: ${timingDetail}`,
    truncateRetainedText(step.modelOutput, MAX_RUN_LOG_TIMELINE_FIELD_CHARS),
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

export function buildAgentStepTimeline(
  step: AgentStep,
  executionResult?: string,
): LogEntry['timeline'] {
  return {
    step: step.index,
    currentApp: step.currentApp,
    packageName: step.deviceState.packageName,
    toolName: step.toolName,
    ...(step.failureClass ? { failureClass: step.failureClass } : {}),
    modelOutput: truncateRetainedText(step.modelOutput, MAX_RUN_LOG_TIMELINE_FIELD_CHARS),
    actionPreview: buildActionPreview(step.action),
    executionActionPreview: buildActionPreview(step.executionAction),
    executionResult: truncateOptionalRetainedText(
      executionResult,
      MAX_RUN_LOG_TIMELINE_FIELD_CHARS,
    ),
  }
}

export function toLogScreenshot(
  value: DeviceScreenshot | null | undefined,
): LogScreenshot | undefined {
  if (!value) {
    return undefined
  }

  const view = modelScreenshotView(value)
  return {
    dataUrl: view.dataUrl,
    screen: view.screen,
  }
}

function compactRunLogEntryInput(entry: LogEntryInput): LogEntryInput {
  return {
    ...entry,
    detail: truncateOptionalRetainedText(entry.detail, MAX_RUN_LOG_DETAIL_CHARS),
    ...(entry.timeline
      ? {
          timeline: {
            ...entry.timeline,
            modelOutput: truncateOptionalRetainedText(
              entry.timeline.modelOutput,
              MAX_RUN_LOG_TIMELINE_FIELD_CHARS,
            ),
            actionPreview: truncateOptionalRetainedText(
              entry.timeline.actionPreview,
              MAX_RUN_LOG_TIMELINE_FIELD_CHARS,
            ),
            executionActionPreview: truncateOptionalRetainedText(
              entry.timeline.executionActionPreview,
              MAX_RUN_LOG_TIMELINE_FIELD_CHARS,
            ),
            executionResult: truncateOptionalRetainedText(
              entry.timeline.executionResult,
              MAX_RUN_LOG_TIMELINE_FIELD_CHARS,
            ),
          },
        }
      : {}),
  }
}
