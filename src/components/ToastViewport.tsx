import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { ToastItem } from '../hooks/useToasts'

export type ToastViewportProps = {
  dismissLabel: string
  onDismiss: (id: number) => void
  toasts: ToastItem[]
}

export function ToastViewport({ dismissLabel, onDismiss, toasts }: ToastViewportProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="toast-viewport">
      {toasts.map((toast) => (
        <div
          className={`toast toast-${toast.tone}`}
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.tone === 'ok' ? (
              <CheckCircle2 size={17} />
            ) : toast.tone === 'warn' || toast.tone === 'error' ? (
              toast.tone === 'error' ? <XCircle size={17} /> : <AlertTriangle size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail ? <span>{toast.detail}</span> : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label={dismissLabel}
            title={dismissLabel}
            onClick={() => onDismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
