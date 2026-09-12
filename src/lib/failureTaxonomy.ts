import { DeviceBackendError } from '../adapters/deviceTypes'
import { isAbortError } from './abortSignal'
import { ActionValidationError } from './actionTypes'
import { OpenAiClientError } from './openAiErrors'
import type { ActionToolResult } from './toolRegistry'

/**
 * Failure classes are decided where the failure happens, never inferred by
 * pattern-matching human-readable summaries.
 *
 * There is deliberately no `device_unavailable` class: the codebase has no
 * distinct connection-loss error signal today, so such a class could only ever
 * be guessed. Connection-time failures classify as `device_io` for now.
 */
export const FAILURE_CLASSES = [
  'model_transport',
  'model_output',
  'action_invalid',
  'unsupported_action',
  'device_io',
  'device_timeout',
  'loop_guard',
  'aborted',
  'unknown',
] as const

export type FailureClass = (typeof FAILURE_CLASSES)[number]

export function isFailureClass(value: unknown): value is FailureClass {
  return typeof value === 'string' && FAILURE_CLASSES.includes(value as FailureClass)
}

export type FailureClassificationHints = {
  /**
   * Some error classes are module-private (e.g. InvalidModelActionError lives
   * inside agent.ts), so the throw site must be able to name the class itself.
   */
  force?: FailureClass
}

export function classifyThrownFailure(
  error: unknown,
  hints: FailureClassificationHints = {},
): FailureClass {
  if (hints.force) {
    return hints.force
  }
  if (isAbortError(error)) {
    return 'aborted'
  }
  if (error instanceof DeviceBackendError) {
    return error.kind === 'timeout' ? 'device_timeout' : 'device_io'
  }
  if (error instanceof OpenAiClientError) {
    return 'model_transport'
  }
  if (error instanceof ActionValidationError) {
    return 'action_invalid'
  }
  return 'unknown'
}

/** Transient device hiccups are worth one more attempt; nothing else is. */
export const AUTO_RECOVERABLE_FAILURES: ReadonlySet<FailureClass> = new Set([
  'device_io',
  'device_timeout',
])

export function isAutoRecoverableFailureClass(value: FailureClass) {
  return AUTO_RECOVERABLE_FAILURES.has(value)
}

export function isAutoRecoverableExecutionFailure(result: ActionToolResult) {
  return result.failureKind !== undefined && isAutoRecoverableFailureClass(result.failureKind)
}
