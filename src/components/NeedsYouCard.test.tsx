// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_COPY } from '../lib/appCopy'
import { AppProvider } from './AppContext'
import { NeedsYouCard } from './NeedsYouCard'

afterEach(cleanup)

function renderCard(props: Partial<Parameters<typeof NeedsYouCard>[0]> = {}) {
  const onContinue = vi.fn()
  const onOpenRunLog = vi.fn()
  render(
    <AppProvider value={{ copy: APP_COPY['en-US'], locale: 'en-US' }}>
      <NeedsYouCard
        onContinue={onContinue}
        onOpenRunLog={onOpenRunLog}
        status="awaiting_takeover"
        {...props}
      />
    </AppProvider>,
  )
  return { onContinue, onOpenRunLog }
}

describe('NeedsYouCard', () => {
  it('turns a captcha takeover into one clear action', () => {
    const { onContinue, onOpenRunLog } = renderCard({ message: 'Please complete the captcha.' })

    expect(screen.getByRole('heading', { name: 'Complete the verification' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Handled — continue' }))
    expect(onContinue).toHaveBeenCalledWith(APP_COPY['en-US'].resumeAfterTakeoverMessage)

    fireEvent.click(screen.getByRole('button', { name: 'View process' }))
    expect(onOpenRunLog).toHaveBeenCalledTimes(1)
  })

  it('uses the structured takeover kind even when the message mentions another flow', () => {
    renderCard({
      message: 'Please complete the captcha.',
      takeoverKind: 'login',
    })

    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Complete the verification' })).toBeNull()
  })


  it('focuses the composer instead of sending a canned answer', () => {
    const onAnswer = vi.fn()
    const { onContinue } = renderCard({
      message: 'Which Wi-Fi network should I use?',
      onAnswer,
      status: 'awaiting_review',
    })

    expect(screen.getByRole('heading', { name: 'The agent needs an answer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Answer below' }))
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('uses the structured review kind for answer and confirmation cards', () => {
    renderCard({
      message: 'Which account should I use',
      reviewKind: 'answer',
      status: 'awaiting_review',
    })
    expect(screen.getByRole('heading', { name: 'The agent needs an answer' })).toBeTruthy()
  })

  it('renders a real paused run with a resume action', () => {
    const onResume = vi.fn()
    const { onContinue } = renderCard({
      status: 'paused',
      onResume,
    })

    expect(screen.getByRole('heading', { name: 'Paused' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume run' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('renders an aborted run as paused with a continue action', () => {
    const { onContinue } = renderCard({
      failureClass: 'aborted',
      message: 'Run stopped',
      status: 'stopped',
    })

    expect(screen.getByRole('heading', { name: 'Paused' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledWith(APP_COPY['en-US'].continueAfterStopMessage)
  })
})
