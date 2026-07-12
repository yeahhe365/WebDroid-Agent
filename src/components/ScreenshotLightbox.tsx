import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode, type WheelEvent } from 'react'
import { useBodyOverflow } from '../hooks/useBodyOverflow'
import { useDisplayImageUrl } from '../hooks/useDisplayImageUrl'

export type ScreenshotSource = {
  dataUrl: string
  screen: {
    width: number
    height: number
  }
}

export type ScreenshotLightboxProps = {
  screenshot: ScreenshotSource
  title: string
  thumbnailAlt: string
  expandedAlt: string
  openButtonLabel?: string
  dialogLabel?: string
  closeLabel?: string
  resetZoomLabel?: string
  thumbnailClassName: string
  zoomControlsLabel?: string
  zoomInLabel?: string
  zoomOutLabel?: string
  overlayClassName?: string
  modalClassName?: string
  panelClassName?: string
  headerClassName?: string
  closeClassName?: string
  children?: ReactNode
}

export function ScreenshotLightbox({
  screenshot,
  title,
  thumbnailAlt,
  expandedAlt,
  openButtonLabel,
  dialogLabel,
  closeLabel = 'Close screenshot preview',
  resetZoomLabel = 'Reset screenshot zoom',
  thumbnailClassName,
  zoomControlsLabel = 'Screenshot zoom controls',
  zoomInLabel = 'Zoom in screenshot',
  zoomOutLabel = 'Zoom out screenshot',
  overlayClassName = 'log-screenshot-overlay',
  modalClassName = 'screenshot-modal',
  panelClassName = 'screenshot-modal-panel',
  headerClassName = 'screenshot-modal-header',
  closeClassName = 'screenshot-modal-close',
  children,
}: ScreenshotLightboxProps) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const zoomPercent = Math.round(zoom * 100)
  const displayUrl = useDisplayImageUrl(screenshot.dataUrl) ?? screenshot.dataUrl

  useBodyOverflow(open)

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

  function updateZoom(delta: number) {
    setZoom((current) => {
      const next = current + delta
      return Math.min(4, Math.max(0.5, Math.round(next * 100) / 100))
    })
  }

  function zoomScreenshot(event: WheelEvent) {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    updateZoom(direction * 0.15)
  }

  return (
    <>
      <button
        type="button"
        className={thumbnailClassName}
        aria-label={openButtonLabel ?? `Open screenshot for ${title}`}
        onClick={openLightbox}
      >
        <img src={displayUrl} alt={thumbnailAlt} decoding="async" loading="lazy" />
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
          aria-label={dialogLabel ?? `Screenshot for ${title}`}
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
              <div className="screenshot-modal-toolbar">
                <div className="screenshot-modal-zoom-controls" aria-label={zoomControlsLabel}>
                  <button
                    type="button"
                    aria-label={zoomOutLabel}
                    title={zoomOutLabel}
                    onClick={() => updateZoom(-0.25)}
                    disabled={zoom <= 0.5}
                  >
                    <Minus size={14} />
                  </button>
                  <span>{zoomPercent}%</span>
                  <button
                    type="button"
                    aria-label={zoomInLabel}
                    title={zoomInLabel}
                    onClick={() => updateZoom(0.25)}
                    disabled={zoom >= 4}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={resetZoomLabel}
                    title={resetZoomLabel}
                    onClick={() => setZoom(1)}
                    disabled={zoom === 1}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className={closeClassName}
                  onClick={() => setOpen(false)}
                  aria-label={closeLabel}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="screenshot-modal-viewport" onWheel={zoomScreenshot}>
              <img
                src={displayUrl}
                alt={expandedAlt}
                decoding="async"
                style={{ height: `${zoomPercent}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
