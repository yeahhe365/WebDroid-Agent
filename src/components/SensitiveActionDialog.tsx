import { AlertTriangle, Check, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AgentAction } from '../lib/actionTypes'
import { buildActionPreview } from '../lib/actionPreview'
import type { AppCopy } from '../lib/appCopy'

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
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!request) {
      return
    }

    function focusableElements() {
      const panel = panelRef.current
      if (!panel) {
        return []
      }
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'))
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const elements = focusableElements()
      if (elements.length === 0) {
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement as HTMLElement | null
      const index = active ? elements.indexOf(active) : -1

      event.preventDefault()
      if (event.shiftKey) {
        ;(index <= 0 ? last : elements[index - 1]).focus()
        return
      }
      ;(index === -1 || index === elements.length - 1 ? first : elements[index + 1]).focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    confirmButtonRef.current?.focus()

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, request])

  if (!request) {
    return null
  }

  const preview = buildActionPreview(request.action)

  return (
    <div
      className="sensitive-action-dialog-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensitive-action-title"
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
            <h2 id="sensitive-action-title">{copy.sensitiveActionTitle}</h2>
          </div>
        </header>

        <p className="sensitive-action-dialog-message">{request.message}</p>

        <div className="sensitive-action-dialog-preview" aria-label={copy.stepParsedAction}>
          <span>{copy.stepParsedAction}</span>
          <code>{preview}</code>
        </div>

        <p className="sensitive-action-dialog-prompt">{copy.sensitiveActionPrompt}</p>

        <div className="sensitive-action-dialog-actions">
          <button type="button" onClick={onCancel}>
            <X size={16} />
            {copy.cancel}
          </button>
          <button type="button" className="primary" onClick={onConfirm} ref={confirmButtonRef}>
            <Check size={16} />
            {copy.execute}
          </button>
        </div>
      </section>
    </div>
  )
}
