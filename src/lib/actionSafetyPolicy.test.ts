import { describe, expect, it } from 'vitest'
import { evaluateActionSafety } from './actionSafetyPolicy'

describe('evaluateActionSafety', () => {
  it('requires takeover for login, password, captcha, and verification-code steps', () => {
    expect(
      evaluateActionSafety(
        { action: 'input_text', text: '123456' },
        { task: 'Enter the SMS verification code' },
      ),
    ).toEqual({
      decision: 'take_over',
      category: 'secret_or_login',
      risk: 'high',
      takeoverKind: 'captcha',
      message:
        'Safety policy requires manual takeover for login, password, captcha, or verification-code steps.',
    })

    expect(
      evaluateActionSafety(
        { action: 'input_text', text: 'hunter2' },
        { task: 'Sign in with the account password' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'take_over',
        category: 'secret_or_login',
        takeoverKind: 'login',
      }),
    )
  })

  it('hands payments to the user and blocks irreversible destructive actions', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Pay now and place order' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'take_over',
        category: 'payment',
        risk: 'critical',
        // The card the UI shows is chosen from this kind, so a payment stop must
        // never fall back to the generic take-over copy.
        takeoverKind: 'payment',
      }),
    )

    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Delete account permanently' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'block',
        category: 'critical_destructive',
      }),
    )
  })

  it('requires confirmation for authorization and payment-context actions without model risk metadata', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Allow Contacts permission' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'confirm',
        category: 'authorization',
      }),
    )

    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { deviceState: { app: 'Alipay', packageName: 'com.eg.android.AlipayGphone' } },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'confirm',
        category: 'payment_context',
      }),
    )
  })

  it('allows typing a local secret even when the reason mentions a password', () => {
    expect(
      evaluateActionSafety(
        { action: 'type_secret', secretId: 'gmail', reason: 'enter the password' },
        { task: 'log in to Gmail' },
      ),
    ).toEqual({ decision: 'allow', risk: 'none' })
  })

  it('keeps critical blocks for type_secret when the task is irreversible', () => {
    expect(
      evaluateActionSafety(
        { action: 'type_secret', secretId: 'gmail', reason: 'confirm' },
        { task: 'Delete account permanently' },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'block',
        category: 'critical_destructive',
      }),
    )
  })

  it('does not require confirmation just because a read-only task mentions orders', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200, reason: 'open order list' },
        { task: '查看我的订单' },
      ),
    ).toEqual({ decision: 'allow', risk: 'none' })
  })

  it('still confirms inside a real payment or billing screen', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200, reason: 'open billing' },
        { deviceState: { app: 'Billing' } },
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'confirm',
        category: 'payment_context',
      }),
    )
  })

  it('allows non-mutating actions even in sensitive contexts', () => {
    expect(
      evaluateActionSafety(
        { action: 'wait', ms: 1000 },
        { task: 'Wait on payment page' },
      ),
    ).toEqual({ decision: 'allow', risk: 'none' })
  })
})

describe('evaluateActionSafety with a strictness setting', () => {
  it('downgrades a login step to a plain confirmation when relaxed', () => {
    const result = evaluateActionSafety(
      { action: 'input_text', text: 'hunter2' },
      { task: 'Sign in with the account password', strictness: 'relaxed' },
    )

    expect(result).toEqual(
      expect.objectContaining({ decision: 'confirm', category: 'secret_or_login' }),
    )
    // A confirmation dialog must not be dressed up as a take-over card.
    expect(result.takeoverKind).toBeUndefined()
  })

  it('asks for a take-over instead of a confirmation when strict', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Allow Contacts permission', strictness: 'strict' },
      ),
    ).toEqual(
      expect.objectContaining({ decision: 'take_over', category: 'authorization' }),
    )
  })

  it('never lets the setting soften a payment or an irreversible action', () => {
    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Pay now and place order', strictness: 'relaxed' },
      ),
    ).toEqual(expect.objectContaining({ decision: 'take_over', takeoverKind: 'payment' }))

    expect(
      evaluateActionSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Delete account permanently', strictness: 'relaxed' },
      ),
    ).toEqual(expect.objectContaining({ decision: 'block' }))
  })

  it('does not let the setting reach the irreversible guard', async () => {
    const { evaluateIrreversibleSafety } = await import('./actionSafetyPolicy')

    expect(
      evaluateIrreversibleSafety(
        { action: 'tap', x: 100, y: 200 },
        { task: 'Delete account permanently', strictness: 'relaxed' },
      ),
    ).toEqual(expect.objectContaining({ decision: 'block' }))
  })
})
