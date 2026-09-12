import { Logs, Trash2 } from 'lucide-react'
import type { LogEntry } from '../lib/runLogEntries'
import { ScreenshotLightbox } from './ScreenshotLightbox'

export type { LogEntry } from '../lib/runLogEntries'

export type RunLogLabels = {
  clear: string
  closeScreenshotPreview: string
  empty: string
  executionResult: string
  expandedScreenshotFor: (title: string) => string
  failureClass: string
  modelOutput: string
  openScreenshotFor: (title: string) => string
  parsedAction: string
  resetScreenshotZoom: string
  screenshotDialogFor: (title: string) => string
  screenshotFor: (title: string) => string
  screenshotZoomControls: string
  step: (step: number) => string
  title: string
  zoomInScreenshot: string
  zoomOutScreenshot: string
}

export type RunLogProps = {
  logs: LogEntry[]
  onClear: () => void
  labels?: RunLogLabels
}

type StepTimelineProps = {
  labels: RunLogLabels
  timeline: NonNullable<LogEntry['timeline']>
}

type TimelineFieldProps = {
  label: string
  value: string
}

export function RunLog({
  logs,
  onClear,
  labels = {
    clear: 'Clear',
    closeScreenshotPreview: 'Close screenshot preview',
    empty: 'No events yet',
    executionResult: 'Execution result',
    expandedScreenshotFor: (title: string) => `Expanded screenshot for ${title}`,
    failureClass: 'Failure class',
    modelOutput: 'Model output',
    openScreenshotFor: (title: string) => `Open screenshot for ${title}`,
    parsedAction: 'Parsed action',
    resetScreenshotZoom: 'Reset screenshot zoom',
    screenshotDialogFor: (title: string) => `Screenshot for ${title}`,
    screenshotFor: (title: string) => `Screenshot for ${title}`,
    screenshotZoomControls: 'Screenshot zoom controls',
    step: (step: number) => `Step ${step}`,
    title: 'Run Log',
    zoomInScreenshot: 'Zoom in screenshot',
    zoomOutScreenshot: 'Zoom out screenshot',
  },
}: RunLogProps) {
  return (
    <section className="log-section">
      <div className="panel-title log-title">
        <span>
          <Logs size={18} />
          <h2>{labels.title}</h2>
        </span>
        <button type="button" onClick={onClear} disabled={logs.length === 0}>
          <Trash2 size={16} />
          {labels.clear}
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <div className="log-empty-state">
            <Logs size={20} strokeWidth={2} aria-hidden="true" />
            <p>{labels.empty}</p>
          </div>
        ) : null}
        {logs.map((entry) => (
          <article
            className={`log-entry ${entry.tone}${entry.screenshot ? ' with-screenshot' : ''}`}
            key={entry.id}
          >
            <div className="log-entry-content">
              <time>{entry.time}</time>
              <strong>{entry.title}</strong>
            </div>
            {entry.detail || entry.timeline || entry.screenshot ? (
              <div className="log-entry-body">
                <div className="log-entry-text">
                  {entry.timeline ? (
                    <StepTimeline labels={labels} timeline={entry.timeline} />
                  ) : null}
                  {entry.detail ? <pre>{entry.detail}</pre> : null}
                </div>
                {entry.screenshot ? (
                  <div className="log-entry-media">
                    <ScreenshotLightbox
                      screenshot={entry.screenshot}
                      title={entry.title}
                      thumbnailAlt={labels.screenshotFor(entry.title)}
                      expandedAlt={labels.expandedScreenshotFor(entry.title)}
                      openButtonLabel={labels.openScreenshotFor(entry.title)}
                      dialogLabel={labels.screenshotDialogFor(entry.title)}
                      closeLabel={labels.closeScreenshotPreview}
                      resetZoomLabel={labels.resetScreenshotZoom}
                      thumbnailClassName="log-screenshot-button"
                      zoomControlsLabel={labels.screenshotZoomControls}
                      zoomInLabel={labels.zoomInScreenshot}
                      zoomOutLabel={labels.zoomOutScreenshot}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function StepTimeline({ labels, timeline }: StepTimelineProps) {
  return (
    <div className="step-timeline">
      <div className="step-timeline-header">
        {timeline.step ? <span>{labels.step(timeline.step)}</span> : null}
        {timeline.currentApp ? <strong>{timeline.currentApp}</strong> : null}
        {timeline.packageName ? <code>{timeline.packageName}</code> : null}
      </div>
      {timeline.modelOutput ? (
        <TimelineField label={labels.modelOutput} value={timeline.modelOutput} />
      ) : null}
      {timeline.failureClass ? (
        <TimelineField label={labels.failureClass} value={timeline.failureClass} />
      ) : null}
      {timeline.actionPreview || timeline.executionActionPreview ? (
        <TimelineField
          label={labels.parsedAction}
          value={[
            timeline.actionPreview,
            timeline.executionActionPreview &&
            timeline.executionActionPreview !== timeline.actionPreview
              ? timeline.executionActionPreview
              : null,
          ]
            .filter(Boolean)
            .join('\n')}
        />
      ) : null}
      {timeline.executionResult ? (
        <TimelineField label={labels.executionResult} value={timeline.executionResult} />
      ) : null}
    </div>
  )
}

function TimelineField({ label, value }: TimelineFieldProps) {
  return (
    <div className="step-timeline-field">
      <span>{label}</span>
      <pre>{value}</pre>
    </div>
  )
}
