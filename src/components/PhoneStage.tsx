import { Check, Loader2, Maximize2, Minimize2, RotateCcw, Usb, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type WheelEvent,
} from 'react'
import { DEFAULT_SWIPE_DURATION_MS, POINTER_SWIPE_THRESHOLD_PX } from '../lib/actionDefaults'
import { buildActionPreview } from '../lib/actionPreview'
import type { AgentAction } from '../lib/actionTypes'
import type { AppCopy } from '../lib/appCopy'
import type { AgentStep } from '../lib/agent'
import { mapActionCoordinates, modelScreenshotView } from '../lib/screenshot'
import { AgentCursor } from './AgentCursor'
import { ScreenshotLightbox, type ScreenshotSource } from './ScreenshotLightbox'
import type { BusyTask } from '../lib/busyTask'
import type { CursorPoint } from '../lib/cursorMotion'
import { useBodyOverflow } from '../hooks/useBodyOverflow'

export type PhoneStageProps = {
  copy: AppCopy
  displayedScreenshot: ScreenshotSource | null
  onConnectDevice?: () => void
  onRunInteractiveAction?: (action: AgentAction) => void
  pendingStep: AgentStep | null
  busyTask?: BusyTask | null
  runningAgent?: boolean
  deviceConnected?: boolean
}

export function PhoneStage({
  copy,
  displayedScreenshot,
  onConnectDevice,
  onRunInteractiveAction,
  pendingStep,
  busyTask = null,
  runningAgent = false,
  deviceConnected = false,
}: PhoneStageProps) {
  const [draftAction, setDraftAction] = useState<AgentAction | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const screenshotLayerRef = useRef<HTMLSpanElement | null>(null)
  const [screenshotButtonSize, setScreenshotButtonSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const hasScreenshot = displayedScreenshot !== null
  const isFullscreenPreview = hasScreenshot && fullscreen
  const isAgentRunning = busyTask?.id === 'run-agent' || runningAgent

  // ponytail: busier states reuse the busyTask signal useDeviceController already sets
  // (runTask ids 'connect-device'/'capture-screen'/'disconnect-device') — no new state needed.
  type PlaceholderState =
    | 'connecting'
    | 'capturing'
    | 'disconnecting'
    | 'connected-waiting'
    | 'idle'
  const placeholderState: PlaceholderState =
    busyTask?.id === 'connect-device'
      ? 'connecting'
      : busyTask?.id === 'capture-screen'
        ? 'capturing'
        : busyTask?.id === 'disconnect-device'
          ? 'disconnecting'
          : deviceConnected && !displayedScreenshot
            ? 'connected-waiting'
            : 'idle'
  const placeholderLabel =
    placeholderState === 'connecting'
      ? copy.connectingDevice
      : placeholderState === 'capturing'
        ? copy.capturingScreen
        : placeholderState === 'disconnecting'
          ? copy.disconnectingDevice
          : placeholderState === 'connected-waiting'
            ? copy.deviceConnected
            : !deviceConnected
              ? copy.connectDeviceCta
              : copy.noScreenshot
  const isPlaceholderBusy = placeholderState !== 'idle' && placeholderState !== 'connected-waiting'

  useBodyOverflow(isFullscreenPreview)

  const cursor: CursorPoint | null = (() => {
    if (!displayedScreenshot || !isAgentRunning) return null
    if (!pendingStep) return null
    const action = pendingStep.executionAction
    if (action.action === 'tap' || action.action === 'long_press' || action.action === 'double_tap') {
      const ss = displayedScreenshot.screen
      const actionX = action.x
      const actionY = action.y
      const containerWidth = screenshotButtonSize?.width ?? ss.width
      const containerHeight = screenshotButtonSize?.height ?? ss.height
      return {
        x: (actionX / ss.width) * containerWidth,
        y: (actionY / ss.height) * containerHeight,
        visible: true,
        animateMovement: true,
        moveSequence: pendingStep.index,
      }
    }
    return null
  })()
  const stageLabel = displayedScreenshot ? copy.androidScreenshot : placeholderLabel
  const stageClassName = [
    'phone-stage',
    isFullscreenPreview ? 'phone-stage-fullscreen' : '',
    hasScreenshot ? 'phone-stage-has-screenshot' : 'phone-stage-empty',
  ]
    .filter(Boolean)
    .join(' ')
  const zoomPercent = Math.round(zoom * 100)
  const surfacePercent = hasScreenshot ? zoomPercent : 100
  const screenshotLayerStyle =
    displayedScreenshot && screenshotButtonSize
      ? containedImageLayerStyle(displayedScreenshot.screen, screenshotButtonSize)
      : undefined
  const pendingOverlay = displayedScreenshot
    ? pendingStepOverlay(pendingStep, displayedScreenshot)
    : null

  useEffect(() => {
    if (!isFullscreenPreview) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFullscreen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isFullscreenPreview])

  useEffect(() => {
    if (!displayedScreenshot) {
      return
    }

    const layer = screenshotLayerRef.current
    const container = layer?.parentElement
    if (!container) {
      return
    }

    const updateSize = (rect?: DOMRectReadOnly) => {
      const measured = rect ?? container.getBoundingClientRect()
      if (measured.width <= 0 || measured.height <= 0) {
        return
      }
      setScreenshotButtonSize((current) =>
        current?.width === measured.width && current.height === measured.height
          ? current
          : { width: measured.width, height: measured.height },
      )
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateSize()
      window.addEventListener('resize', handleResize)
      return () => {
        window.removeEventListener('resize', handleResize)
      }
    }

    const observer = new ResizeObserver((entries) => {
      updateSize(entries[0]?.contentRect)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [displayedScreenshot])

  function pointerToScreenPoint(event: MouseEvent<HTMLElement>) {
    if (!displayedScreenshot) {
      return { x: 0, y: 0 }
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const xRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    const yRatio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
    return {
      x: screenCoordinateFromRatio(xRatio, displayedScreenshot.screen.width),
      y: screenCoordinateFromRatio(yRatio, displayedScreenshot.screen.height),
    }
  }

  function startInteraction(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDragStart(pointerToScreenPoint(event))
  }

  function finishInteraction(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!dragStart) {
      return
    }

    const end = pointerToScreenPoint(event)
    const distance = Math.hypot(end.x - dragStart.x, end.y - dragStart.y)
    setDraftAction(
      distance > POINTER_SWIPE_THRESHOLD_PX
        ? {
            action: 'swipe',
            fromX: dragStart.x,
            fromY: dragStart.y,
            toX: end.x,
            toY: end.y,
            durationMs: DEFAULT_SWIPE_DURATION_MS,
          }
        : {
            action: 'tap',
            x: dragStart.x,
            y: dragStart.y,
          },
    )
    setDragStart(null)
  }

  function changeZoom(delta: number) {
    setZoom((current) => clamp(Math.round((current + delta) * 100) / 100, 1, 3))
  }

  function zoomWithWheel(event: WheelEvent<HTMLElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }

    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 0.25 : -0.25)
  }

  return (
    <section className={stageClassName} aria-label={stageLabel}>
      <>
        <div
          className={isFullscreenPreview ? 'phone-frame phone-frame-fullscreen' : 'phone-frame'}
          role={isFullscreenPreview ? 'dialog' : undefined}
          aria-modal={isFullscreenPreview ? true : undefined}
          aria-label={isFullscreenPreview ? copy.fullscreenPhonePreview : undefined}
        >
          <div className="phone-viewport" onWheel={zoomWithWheel}>
            <div
              className="phone-zoom-surface"
              style={{ height: `${surfacePercent}%`, width: `${surfacePercent}%` }}
            >
              {displayedScreenshot ? (
                <ScreenshotLightbox
                  screenshot={displayedScreenshot}
                  title={copy.androidScreenshot}
                  thumbnailAlt={copy.androidScreenshot}
                  expandedAlt={copy.expandedAndroidScreenshot}
                  openButtonLabel={copy.openScreenshotFor(copy.androidScreenshot)}
                  dialogLabel={copy.screenshotDialogFor(copy.androidScreenshot)}
                  closeLabel={copy.closeScreenshotPreview}
                  resetZoomLabel={copy.resetScreenshotZoom}
                  thumbnailClassName="phone-screenshot-button"
                  zoomControlsLabel={copy.screenshotZoomControls}
                  zoomInLabel={copy.zoomInScreenshot}
                  zoomOutLabel={copy.zoomOutScreenshot}
                >
                  <span
                    className="screenshot-visible-layer"
                    ref={screenshotLayerRef}
                    style={screenshotLayerStyle}
                  >
                    {pendingOverlay ? (
                      <ActionOverlay
                        action={pendingOverlay.action}
                        screen={displayedScreenshot.screen}
                        title={pendingOverlay.title}
                      />
                    ) : null}
                    {draftAction ? (
                      <ActionOverlay
                        action={draftAction}
                        screen={displayedScreenshot.screen}
                        title={buildActionPreview(draftAction)}
                      />
                    ) : null}
                    {onRunInteractiveAction ? (
                      <span
                        aria-label={copy.screenshotInteractionLayer}
                        className="screenshot-command-layer"
                        role="presentation"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onMouseDown={startInteraction}
                        onMouseLeave={() => setDragStart(null)}
                        onMouseUp={finishInteraction}
                      />
                    ) : null}
                    {cursor && screenshotButtonSize ? (
                      <AgentCursor
                        cursor={cursor}
                        isVisible={true}
                        viewportSize={screenshotButtonSize}
                      />
                    ) : null}
                  </span>
                </ScreenshotLightbox>
              ) : (
                <div className="phone-screen-placeholder" aria-busy={isPlaceholderBusy || undefined}>
                  <div className="phone-empty-state">
                    {isPlaceholderBusy ? (
                      <Loader2 size={22} aria-hidden="true" className="spin" />
                    ) : (
                      <Usb size={22} aria-hidden="true" />
                    )}
                    <strong>{placeholderLabel}</strong>
                    {isPlaceholderBusy ? null : (
                      <span>
                        {placeholderState === 'idle' && !deviceConnected
                          ? copy.connectDeviceHint
                          : copy.noScreenshotHint}
                      </span>
                    )}
                    {placeholderState === 'idle' && !deviceConnected && onConnectDevice ? (
                      <button
                        type="button"
                        className="phone-connect-cta"
                        onClick={onConnectDevice}
                        disabled={Boolean(busyTask)}
                      >
                        <Usb size={14} aria-hidden="true" />
                        {copy.connect}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
          {displayedScreenshot && draftAction ? (
            <div className="screenshot-command-draft">
              <span>{previewInteractiveAction(draftAction)}</span>
              <button
                type="button"
                aria-label={copy.runGeneratedAction}
                onClick={() => onRunInteractiveAction?.(draftAction)}
              >
                <Check size={14} />
                {copy.execute}
              </button>
              <button
                type="button"
                aria-label={copy.clearGeneratedAction}
                onClick={() => setDraftAction(null)}
              >
                <X size={14} />
                {copy.clear}
              </button>
            </div>
          ) : null}
        </div>
        {hasScreenshot ? (
          <div className="phone-zoom-controls" aria-label={copy.screenshotZoomControls}>
            <button
              type="button"
              aria-label={copy.zoomOutScreenshot}
              title={copy.zoomOutScreenshot}
              onClick={() => changeZoom(-0.25)}
              disabled={zoom <= 1}
            >
              <ZoomOut size={14} />
            </button>
            <span>{zoomPercent}%</span>
            <button
              type="button"
              aria-label={copy.zoomInScreenshot}
              title={copy.zoomInScreenshot}
              onClick={() => changeZoom(0.25)}
              disabled={zoom >= 3}
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              aria-label={copy.resetScreenshotZoom}
              title={copy.resetScreenshotZoom}
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              aria-label={fullscreen ? copy.exitPhoneFullscreen : copy.showPhoneFullscreen}
              title={fullscreen ? copy.exitPhoneFullscreen : copy.showPhoneFullscreen}
              onClick={() => setFullscreen((current) => !current)}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        ) : null}
      </>
    </section>
  )
}

function previewInteractiveAction(action: AgentAction) {
  if (action.action === 'swipe') {
    return `swipe (${action.fromX}, ${action.fromY}) -> (${action.toX}, ${action.toY})`
  }
  return buildActionPreview(action)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function screenCoordinateFromRatio(ratio: number, axisSize: number) {
  const maxCoordinate = Math.max(0, axisSize - 1)
  return clamp(Math.round(clamp(ratio, 0, 1) * axisSize), 0, maxCoordinate)
}

function containedImageLayerStyle(
  screen: { width: number; height: number },
  container: { width: number; height: number },
): CSSProperties {
  if (screen.width <= 0 || screen.height <= 0 || container.width <= 0 || container.height <= 0) {
    return {}
  }

  const imageAspect = screen.width / screen.height
  const containerAspect = container.width / container.height

  if (Math.abs(containerAspect - imageAspect) < 0.0001) {
    return {
      height: '100%',
      left: '0%',
      top: '0%',
      width: '100%',
    }
  }

  if (containerAspect > imageAspect) {
    const width = (imageAspect / containerAspect) * 100
    return {
      height: '100%',
      left: percent((100 - width) / 2),
      top: '0%',
      width: percent(width),
    }
  }

  const height = (containerAspect / imageAspect) * 100
  return {
    height: percent(height),
    left: '0%',
    top: percent((100 - height) / 2),
    width: '100%',
  }
}

function percent(value: number) {
  return `${Math.round(value * 10000) / 10000}%`
}

type ActionOverlayProps = {
  action: AgentAction
  screen: { width: number; height: number }
  title?: string
}

function pendingStepOverlay(
  pendingStep: AgentStep | null,
  displayedScreenshot: ScreenshotSource,
): { action: AgentAction; title: string } | null {
  if (!pendingStep) {
    return null
  }

  const pendingView = modelScreenshotView(pendingStep.screenshot)
  if (
    pendingView.dataUrl !== displayedScreenshot.dataUrl ||
    pendingView.screen.width !== displayedScreenshot.screen.width ||
    pendingView.screen.height !== displayedScreenshot.screen.height
  ) {
    return null
  }

  return {
    action: mapActionCoordinates(
      pendingStep.executionAction,
      pendingStep.screenshot.screen,
      displayedScreenshot.screen,
    ),
    title: buildActionPreview(pendingStep.executionAction),
  }
}

function ActionOverlay({ action, screen, title }: ActionOverlayProps) {
  const rawSwipeMarkerId = useId()
  const swipeMarkerId = `swipe-arrow-${rawSwipeMarkerId.replace(/:/g, '')}`

  if (action.action === 'tap' || action.action === 'long_press' || action.action === 'double_tap') {
    return (
      <span
        className={`tap-marker ${action.action}`}
        title={title}
        style={{
          left: `${(action.x / screen.width) * 100}%`,
          top: `${(action.y / screen.height) * 100}%`,
        }}
      />
    )
  }

  if (action.action === 'swipe') {
    const durationMs = action.durationMs ?? DEFAULT_SWIPE_DURATION_MS
    const labelPosition = swipeLabelPosition(action, screen)

    return (
      <>
        <svg
          aria-label={`Swipe path ${durationMs} ms`}
          className="swipe-path"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${screen.width} ${screen.height}`}
        >
          {title ? <title>{title}</title> : null}
          <defs>
            <marker
              id={swipeMarkerId}
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
              viewBox="0 0 8 8"
            >
              <path className="swipe-path-arrowhead" d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          <line
            className="swipe-path-line"
            markerEnd={`url(#${swipeMarkerId})`}
            x1={action.fromX}
            x2={action.toX}
            y1={action.fromY}
            y2={action.toY}
          />
        </svg>
        <span className="swipe-duration-label" style={labelPosition}>
          {durationMs} ms
        </span>
        <span
          className="swipe-marker start"
          title={title}
          style={{
            left: `${(action.fromX / screen.width) * 100}%`,
            top: `${(action.fromY / screen.height) * 100}%`,
          }}
        />
        <span
          className="swipe-marker end"
          title={title}
          style={{
            left: `${(action.toX / screen.width) * 100}%`,
            top: `${(action.toY / screen.height) * 100}%`,
          }}
        />
      </>
    )
  }

  return null
}

function swipeLabelPosition(
  action: Extract<AgentAction, { action: 'swipe' }>,
  screen: { width: number; height: number },
): CSSProperties {
  return {
    left: `${(((action.fromX + action.toX) / 2) / screen.width) * 100}%`,
    top: `${(((action.fromY + action.toY) / 2) / screen.height) * 100}%`,
  }
}
