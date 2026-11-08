import { describe, expect, it } from 'vitest'
import { evaluateActionSafety } from './actionSafetyPolicy'

describe('evaluateActionSafety NFKC normalization', () => {
  it('normalizes full-width characters before pattern matching', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: '全額付款' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'take_over',
        category: 'payment',
      }),
    )
  })

  it('normalizes math letter variants before pattern matching', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: '𝐩𝐚𝐲 𝐧𝐨𝐰' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'take_over',
        category: 'payment',
      }),
    )
  })

  it('allows type_secret in a password context but still blocks irreversible tasks', () => {
    expect(
      evaluateActionSafety(
        { action: 'type_secret', secretId: 'password' },
        { task: 'Enter the password' },
      ),
    ).toEqual({ decision: 'allow', risk: 'none' })

    expect(
      evaluateActionSafety(
        { action: 'type_secret', secretId: 'password' },
        { task: 'Delete account permanently' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'block',
        category: 'critical_destructive',
      }),
    )
  })
})
