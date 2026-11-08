import { OpenAiClientError } from './openAiErrors'

/**
 * A hung model endpoint used to leave the agent waiting forever: the fetch had
 * no timeout and the only escape was the user pressing Stop. 180s is generous
 * for a vision model with reasoning, while still bounding a dead connection.
 */
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 180_000

export type ModelRequestTimeoutOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  label?: string
}

/**
 * Runs a model request (including reading the response body) under an overall
 * timeout. The timeout aborts the request and surfaces as an
 * `OpenAiClientError`, so the failure taxonomy classifies it as
 * `model_transport` instead of an unknown error. A user-initiated abort is
 * propagated unchanged so the runner can report `stopped`.
 */
export async function withModelRequestTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  {
    signal,
    timeoutMs = DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
    label = 'Model request',
  }: ModelRequestTimeoutOptions = {},
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run(signal ?? new AbortController().signal)
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const abortFromParent = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', abortFromParent, { once: true })
  }

  try {
    return await run(controller.signal)
  } catch (caught) {
    if (timedOut) {
      throw new OpenAiClientError(`${label} timed out after ${timeoutMs}ms.`)
    }
    throw caught
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromParent)
  }
}
