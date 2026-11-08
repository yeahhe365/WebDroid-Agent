import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastTone = 'info' | 'ok' | 'warn' | 'error'

export type ToastInput = {
  detail?: string
  durationMs?: number
  title: string
  tone?: ToastTone
}

export type ToastItem = ToastInput & {
  id: number
  tone: ToastTone
}

const MAX_VISIBLE_TOASTS = 4
const DEFAULT_DURATION_MS = 4200
const ERROR_DURATION_MS = 7000

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback((input: ToastInput) => {
    const id = nextIdRef.current
    nextIdRef.current += 1
    const toast: ToastItem = {
      ...input,
      id,
      tone: input.tone ?? 'info',
      durationMs:
        input.durationMs ?? (input.tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
    }

    setToasts((current) => [...current, toast].slice(-MAX_VISIBLE_TOASTS))

    const timer = setTimeout(() => {
      timersRef.current.delete(id)
      setToasts((current) => current.filter((entry) => entry.id !== id))
    }, toast.durationMs)
    timersRef.current.set(id, timer)

    return id
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  return { dismissToast, pushToast, toasts }
}
