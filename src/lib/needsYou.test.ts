import { describe, expect, it } from 'vitest'
import { needsYouKind } from './needsYou'

describe('needsYouKind', () => {
  it('classifies takeover reasons', () => {
    expect(needsYouKind('awaiting_takeover', undefined, '请输入验证码')).toBe('captcha')
    expect(needsYouKind('awaiting_takeover', undefined, 'Please sign in')).toBe('login')
    expect(needsYouKind('awaiting_takeover', undefined, 'Payment required')).toBe('payment')
    expect(needsYouKind('awaiting_takeover', undefined, 'Open the settings app')).toBe('takeover')
  })

  it('prefers the structured kind over conflicting message text', () => {
    expect(
      needsYouKind(
        'awaiting_takeover',
        undefined,
        'Please complete the captcha.',
        'login',
      ),
    ).toBe('login')
    expect(
      needsYouKind(
        'awaiting_takeover',
        undefined,
        'Please sign in.',
        'payment',
      ),
    ).toBe('payment')
    expect(
      needsYouKind('awaiting_takeover', undefined, 'Open the settings app.', 'other'),
    ).toBe('takeover')
  })

  it('uses structured review kinds before the question-mark heuristic', () => {
    expect(
      needsYouKind('awaiting_review', undefined, 'Which account', undefined, 'answer'),
    ).toBe('answer')
    expect(
      needsYouKind('awaiting_review', undefined, 'Which account?', undefined, 'confirm'),
    ).toBe('review')
    expect(
      needsYouKind('awaiting_review', undefined, 'Max steps reached', undefined, 'max_steps'),
    ).toBe('max_steps')
    expect(
      needsYouKind('awaiting_review', undefined, 'Blocked by policy', undefined, 'blocked'),
    ).toBe('blocked')
  })

  it('separates questions, reviews, pauses and errors', () => {
    expect(needsYouKind('awaiting_review', undefined, 'Which account should I use?')).toBe('answer')
    expect(needsYouKind('awaiting_review', undefined, 'Max steps reached')).toBe('review')
    expect(needsYouKind('paused')).toBe('paused')
    expect(needsYouKind('stopped', 'aborted', 'Run stopped')).toBe('paused')
    expect(needsYouKind('stopped', 'loop_guard', 'Loop guard')).toBe('stopped')
    expect(needsYouKind('error', 'unknown', 'Boom')).toBe('error')
    expect(needsYouKind('done')).toBeNull()
    expect(needsYouKind('running')).toBeNull()
  })
})
