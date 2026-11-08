import { AlertTriangle, Check, X } from 'lucide-react'
import { useId, useRef } from 'react'
import type { AgentAction } from '../lib/actionTypes'
import { buildActionPreview } from '../lib/actionPreview'
import type { AppCopy } from '../lib/appCopy'
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap'
import { useOverlayLayer } from '../hooks/useOverlayLayer'
import { useBodyOverflow } from '../hooks/useBodyOverflow'

export type SensitiveActionDialogRequest = {
  action: AgentAction
  message: string
}

export type SensitiveActionDialogProps = {
  copy: AppCopy
  onCancel: () => void
  onConfirm: () => void
  request: SensitiveActionDialogRequest | null
}

export function SensitiveActionDialog({
  copy,
  onCancel,
  onConfirm,
  request,
}: SensitiveActionDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const open = request !== null

  useBodyOverflow(open)
  useOverlayLayer(open, onCancel)
  useDialogFocusTrap({
    active: open,
    containerRef: panelRef,
    // Dangerous actions default to the safe choice; Enter should not execute.
    initialFocusRef: cancelButtonRef,
  })

  if (!request) {
    return null
  }

  const preview = buildActionPreview(request.action)

  return (
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
          <div>
            <p className="eyebrow">{copy.confirmSensitiveActions}</p>
            <h2 id={titleId}>{copy.sensitiveActionTitle}</h2>
          </div>
        </header>

        <p className="sensitive-action-dialog-message" id={messageId}>
          {request.message}
        </p>

        <div className="sensitive-action-dialog-preview" aria-label={copy.stepParsedAction}>
          <span>{copy.stepParsedAction}</span>
          <code>{preview}</code>
        </div>

        <p className="sensitive-action-dialog-prompt">{copy.sensitiveActionPrompt}</p>

        <div className="sensitive-action-dialog-actions">
          <button type="button" onClick={onCancel} ref={cancelButtonRef}>
            <X size={16} />
            {copy.cancel}
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            <Check size={16} />
            {copy.execute}
          </button>
        </div>
      </section>
    </div>
  )
}
