import { Maximize2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode, type WheelEvent } from 'react'

export type ScreenshotSource = {
  dataUrl: string
  screen: {
    width: number
    height: number
  }
}

export function ScreenshotLightbox({
  screenshot,
  title,
  thumbnailAlt,
  expandedAlt,
  thumbnailClassName,
  overlayClassName = 'log-screenshot-overlay',
  modalClassName = 'screenshot-modal',
  panelClassName = 'screenshot-modal-panel',
  headerClassName = 'screenshot-modal-header',
  closeClassName = 'screenshot-modal-close',
  children,
}: {
  screenshot: ScreenshotSource
  title: string
  thumbnailAlt: string
  expandedAlt: string
  thumbnailClassName: string
  overlayClassName?: string
  modalClassName?: string
  panelClassName?: string
  headerClassName?: string
  closeClassName?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const zoomPercent = Math.round(zoom * 100)

  useEffect(() => {
    if (!open) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  function openLightbox() {
    setZoom(1)
    setOpen(true)
  }

  function zoomScreenshot(event: WheelEvent) {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    setZoom((current) => {
      const next = current + direction * 0.15
      return Math.min(4, Math.max(0.5, Math.round(next * 100) / 100))
    })
  }

  return (
    <>
      <button
        type="button"
        className={thumbnailClassName}
        aria-label={`Open screenshot for ${title}`}
        onClick={openLightbox}
      >
        <img src={screenshot.dataUrl} alt={thumbnailAlt} />
        {children}
        <span className={overlayClassName}>
          <Maximize2 size={14} />
        </span>
      </button>

      {open ? (
        <div
          className={modalClassName}
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot for ${title}`}
          onClick={() => setOpen(false)}
        >
          <div className={panelClassName} onClick={(event) => event.stopPropagation()}>
            <div className={headerClassName}>
              <div>
                <strong>{title}</strong>
                <small>
                  {screenshot.screen.width}x{screenshot.screen.height}
                </small>
              </div>
              <button
                type="button"
                className={closeClassName}
                onClick={() => setOpen(false)}
                aria-label="Close screenshot preview"
              >
                <X size={16} />
              </button>
            </div>
            <div className="screenshot-modal-viewport" onWheel={zoomScreenshot}>
              <img
                src={screenshot.dataUrl}
                alt={expandedAlt}
                style={{ height: `${zoomPercent}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
