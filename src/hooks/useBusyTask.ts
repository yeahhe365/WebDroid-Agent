import { useCallback, useRef, useState } from 'react'
import type { BusyTask, BusyTaskId } from '../lib/busyTask'

export type BusyTaskError = {
  label: string
  message: string
}

/**
 * Turns a thrown value into the string the banner and the log show. Injected so
 * that errors raised outside React (device adapters, model clients) can be
 * translated before they reach the UI instead of leaking English.
 */
export type BusyTaskErrorFormatter = (caught: unknown) => string

function defaultFormatError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function useBusyTask(
  onError?: (error: BusyTaskError) => void,
  formatError: BusyTaskErrorFormatter = defaultFormatError,
) {
  const [busyTask, setBusyTask] = useState<BusyTask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  const runTask = useCallback(
    async (id: BusyTaskId, label: string, action: () => Promise<void>) => {
      if (inFlightRef.current) {
        return
      }

      inFlightRef.current = true
      setBusyTask({ id, label, startedAt: Date.now() })
      setError(null)
      try {
        await action()
      } catch (caught) {
        const message = formatError(caught)
        setError(message)
        onError?.({ label, message })
      } finally {
        inFlightRef.current = false
        setBusyTask(null)
      }
    },
    [formatError, onError],
  )

  return {
    busyTask,
    error,
    runTask,
    setError,
  }
}
