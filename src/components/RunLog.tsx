import { RotateCcw, Trash2 } from 'lucide-react'
import { ScreenshotLightbox, type ScreenshotSource } from './ScreenshotLightbox'

export type LogScreenshot = ScreenshotSource

export type LogEntry = {
  id: number
  time: string
  tone: 'info' | 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  screenshot?: LogScreenshot
}

export function RunLog({
  logs,
  onClear,
  labels = {
    clear: 'Clear',
    empty: 'No events yet',
    title: 'Run Log',
    screenshotFor: (title: string) => `Screenshot for ${title}`,
    expandedScreenshotFor: (title: string) => `Expanded screenshot for ${title}`,
  },
}: {
  logs: LogEntry[]
  onClear: () => void
  labels?: {
    clear: string
    empty: string
    title: string
    screenshotFor: (title: string) => string
    expandedScreenshotFor: (title: string) => string
  }
}) {
  return (
    <section className="log-section">
      <div className="panel-title log-title">
        <span>
          <RotateCcw size={18} />
          <h2>{labels.title}</h2>
        </span>
        <button type="button" onClick={onClear} disabled={logs.length === 0}>
          <Trash2 size={16} />
          {labels.clear}
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? <p className="muted">{labels.empty}</p> : null}
        {logs.map((entry) => (
          <article
            className={`log-entry ${entry.tone}${entry.screenshot ? ' with-screenshot' : ''}`}
            key={entry.id}
          >
            <div className="log-entry-content">
              <time>{entry.time}</time>
              <strong>{entry.title}</strong>
            </div>
            {entry.detail || entry.screenshot ? (
              <div className="log-entry-body">
                {entry.detail ? <pre>{entry.detail}</pre> : null}
                {entry.screenshot ? (
                  <div className="log-entry-media">
                    <ScreenshotLightbox
                      screenshot={entry.screenshot}
                      title={entry.title}
                      thumbnailAlt={labels.screenshotFor(entry.title)}
                      expandedAlt={labels.expandedScreenshotFor(entry.title)}
                      thumbnailClassName="log-screenshot-button"
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
