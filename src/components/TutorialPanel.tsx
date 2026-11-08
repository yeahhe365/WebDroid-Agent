import {
  BrainCircuit,
  Cable,
  Hand,
  Send,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AppCopy } from '../lib/appCopy'
import { useOverlayLayer } from '../hooks/useOverlayLayer'

type TutorialPanelProps = {
  copy: AppCopy
  onClose: () => void
}

const stepIcons = [Cable, BrainCircuit, Send, Hand] as const

export function TutorialPanel({ copy, onClose }: TutorialPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  useOverlayLayer(true, onClose)

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      id="tutorial-panel"
      className="tutorial-panel"
      aria-label={copy.tutorial}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="tutorial-header">
        <div>
          <p className="eyebrow">{copy.tutorial}</p>
          <h2>{copy.tutorialTitle}</h2>
          <p>{copy.tutorialIntro}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={copy.closeTutorial}
          title={copy.closeTutorial}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <ol className="tutorial-steps">
        {copy.tutorialSteps.map((step, index) => {
          const StepIcon = stepIcons[index % stepIcons.length]
          return (
            <li key={step.title}>
              <span className="tutorial-step-number">{index + 1}</span>
              <div className="tutorial-step-icon" aria-hidden="true">
                <StepIcon size={18} />
              </div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="tutorial-notes">
        <h3>{copy.tutorialNotesTitle}</h3>
        <ul>
          {copy.tutorialNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <div className="tutorial-faq">
        <h3>{copy.tutorialFaqTitle}</h3>
        <div className="tutorial-faq-list">
          {copy.tutorialFaqItems.map((item) => (
            <article key={item.question}>
              <h4>{item.question}</h4>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
