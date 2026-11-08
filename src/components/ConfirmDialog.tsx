import { AlertTriangle, Check, X } from 'lucide-react'
import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap'
import { useOverlayLayer } from '../hooks/useOverlayLayer'
import { useBodyOverflow } from '../hooks/useBodyOverflow'

export type ConfirmDialogProps = {
  cancelLabel: string
  confirmLabel: string
  danger?: boolean
  message: string
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
}

/**
 * Small in-app replacement for window.confirm. Focus defaults to Cancel so a
 * stray Enter cannot destroy local data.
 */
export function ConfirmDialog({
  cancelLabel,
  confirmLabel,
  danger = false,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useBodyOverflow(open)
  useOverlayLayer(open, onCancel)
  useDialogFocusTrap({
    active: open,
    containerRef: panelRef,
    initialFocusRef: cancelButtonRef,
  })

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="sensitive-action-dialog-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onClick={onCancel}
    >
      <section
        className="sensitive-action-dialog-panel"
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
      >
        <header className="sensitive-action-dialog-header">
          <span className="sensitive-action-dialog-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <h2 id={titleId}>{title}</h2>
        </header>
        <p className="sensitive-action-dialog-message" id={messageId}>
          {message}
        </p>
        <div className="sensitive-action-dialog-actions">
          <button type="button" onClick={onCancel} ref={cancelButtonRef}>
            <X size={16} />
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'danger confirm-danger' : 'primary'}
            onClick={onConfirm}
          >
            <Check size={16} />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
