import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAFETY_STRICTNESS,
  SAFETY_CATEGORY_PROFILES,
  decisionRank,
  isSafetyStrictness,
  maxRiskLevel,
  resolveSafetyDecision,
  riskAtLeast,
  riskLevelForCategory,
  type SafetyCategory,
} from './actionRisk'

const CATEGORIES = Object.keys(SAFETY_CATEGORY_PROFILES) as SafetyCategory[]

describe('safety risk grading', () => {
  it('keeps every category profile between its own floor and ceiling', () => {
    for (const category of CATEGORIES) {
      const profile = SAFETY_CATEGORY_PROFILES[category]
      expect(decisionRank(profile.decision)).toBeGreaterThanOrEqual(decisionRank(profile.floor))
      expect(decisionRank(profile.decision)).toBeLessThanOrEqual(decisionRank(profile.ceiling))
    }
  })

  it('defaults every category to the shipped verdict', () => {
    for (const category of CATEGORIES) {
      expect(resolveSafetyDecision(category, DEFAULT_SAFETY_STRICTNESS)).toBe(
        SAFETY_CATEGORY_PROFILES[category].decision,
      )
    }
  })

  it('treats an unknown strictness as the documented default', () => {
    expect(resolveSafetyDecision('authorization', undefined)).toBe('confirm')
  })

  it('relaxes the graded categories one rung without crossing their floor', () => {
    // Medium-risk prompts may become silent, destructive ones may not.
    expect(resolveSafetyDecision('authorization', 'relaxed')).toBe('allow')
    expect(resolveSafetyDecision('payment_context', 'relaxed')).toBe('allow')
    expect(resolveSafetyDecision('destructive', 'relaxed')).toBe('confirm')
    // A login step may become a plain confirmation, never a silent tap.
    expect(resolveSafetyDecision('secret_or_login', 'relaxed')).toBe('confirm')
    // Payments and irreversible actions have a floor of their own verdict.
    expect(resolveSafetyDecision('payment', 'relaxed')).toBe('take_over')
    expect(resolveSafetyDecision('critical_destructive', 'relaxed')).toBe('block')
  })

  it('tightens the graded categories in strict mode, never into a dead end', () => {
    expect(resolveSafetyDecision('authorization', 'strict')).toBe('take_over')
    expect(resolveSafetyDecision('payment_context', 'strict')).toBe('take_over')
    expect(resolveSafetyDecision('destructive', 'strict')).toBe('take_over')
    // Handing the phone over is the harshest useful verdict for a login or a
    // payment: `block` would leave the user with nothing to resume.
    expect(resolveSafetyDecision('secret_or_login', 'strict')).toBe('take_over')
    expect(resolveSafetyDecision('payment', 'strict')).toBe('take_over')
    expect(resolveSafetyDecision('critical_destructive', 'strict')).toBe('block')
  })

  it('grades the categories by how bad an unattended action would be', () => {
    expect(riskLevelForCategory('critical_destructive')).toBe('critical')
    expect(riskLevelForCategory('payment')).toBe('critical')
    expect(riskLevelForCategory('secret_or_login')).toBe('high')
    expect(riskLevelForCategory('destructive')).toBe('high')
    expect(riskLevelForCategory('authorization')).toBe('medium')
    expect(riskLevelForCategory('payment_context')).toBe('medium')
  })

  it('compares risk levels', () => {
    expect(maxRiskLevel('low', 'high')).toBe('high')
    expect(maxRiskLevel('critical', 'medium')).toBe('critical')
    expect(riskAtLeast('high', 'medium')).toBe(true)
    expect(riskAtLeast('low', 'medium')).toBe(false)
  })

  it('only accepts the three user-facing strictness values', () => {
    expect(isSafetyStrictness('relaxed')).toBe(true)
    expect(isSafetyStrictness('balanced')).toBe(true)
    expect(isSafetyStrictness('strict')).toBe(true)
    expect(isSafetyStrictness('paranoid')).toBe(false)
    expect(isSafetyStrictness(1)).toBe(false)
  })
})
