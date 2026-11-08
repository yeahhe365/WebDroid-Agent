/**
 * Risk grading for the local safety policy.
 *
 * The policy itself (`actionSafetyPolicy.ts`) decides *which* category an action
 * falls into; this module decides how strict that category is treated, so the
 * verdict stops being a set of `if`s with hard-coded decisions.
 *
 * Three ideas:
 *
 * - every category has a **risk level** (`low` … `critical`) that describes how
 *   bad it would be if the agent ran it unattended;
 * - every verdict sits on a **ladder**: `allow < confirm < take_over < block`;
 * - every category declares a **floor** and a **ceiling**. The user-facing
 *   strictness setting may move the verdict between them, never outside. That is
 *   what keeps "relaxed" from turning a payment into a silent tap, and what
 *   keeps "strict" from trapping the user behind a wedge it can never clear.
 */

/** How bad it would be if the agent performed this unattended. */
export type ActionRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

/** Ladder from "just do it" to "never let the agent do it". */
export type SafetyDecision = 'allow' | 'confirm' | 'take_over' | 'block'

export type SafetyCategory =
  | 'secret_or_login'
  | 'critical_destructive'
  | 'payment'
  | 'destructive'
  | 'authorization'
  | 'payment_context'

/** User-facing knob. It shifts one rung, bounded by the category floor/ceiling. */
export type SafetyStrictness = 'relaxed' | 'balanced' | 'strict'

export const DEFAULT_SAFETY_STRICTNESS: SafetyStrictness = 'balanced'

export const RISK_LEVEL_ORDER: Record<ActionRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const DECISION_LADDER: readonly SafetyDecision[] = ['allow', 'confirm', 'take_over', 'block']

type CategoryProfile = {
  /** Verdict for `balanced`, i.e. the shipped default behaviour. */
  decision: SafetyDecision
  /** Relaxing may never soften past this rung. */
  floor: SafetyDecision
  /** Tightening may never push past this rung. */
  ceiling: SafetyDecision
  level: ActionRiskLevel
}

export const SAFETY_CATEGORY_PROFILES: Record<SafetyCategory, CategoryProfile> = {
  // Logins and captchas must be done by a human, but a plain "confirm" is still
  // an honest relaxation: the agent still cannot act without the user saying so.
  secret_or_login: { decision: 'take_over', floor: 'confirm', ceiling: 'take_over', level: 'high' },
  // Irreversible: no setting may soften or harden these, they are always blocked.
  critical_destructive: { decision: 'block', floor: 'block', ceiling: 'block', level: 'critical' },
  // Payments are handed to the user, never executed by the agent. `relaxed`
  // cannot soften this one — the floor is the verdict itself.
  payment: { decision: 'take_over', floor: 'take_over', ceiling: 'take_over', level: 'critical' },
  destructive: { decision: 'confirm', floor: 'confirm', ceiling: 'take_over', level: 'high' },
  authorization: { decision: 'confirm', floor: 'allow', ceiling: 'take_over', level: 'medium' },
  payment_context: { decision: 'confirm', floor: 'allow', ceiling: 'take_over', level: 'medium' },
}

export function isSafetyStrictness(value: unknown): value is SafetyStrictness {
  return value === 'relaxed' || value === 'balanced' || value === 'strict'
}

export function decisionRank(decision: SafetyDecision): number {
  return DECISION_LADDER.indexOf(decision)
}

export function riskLevelForCategory(category: SafetyCategory): ActionRiskLevel {
  return SAFETY_CATEGORY_PROFILES[category].level
}

/** Orders two levels; used by the audit trail and the run summary. */
export function maxRiskLevel(left: ActionRiskLevel, right: ActionRiskLevel): ActionRiskLevel {
  return RISK_LEVEL_ORDER[left] >= RISK_LEVEL_ORDER[right] ? left : right
}

export function riskAtLeast(level: ActionRiskLevel, threshold: ActionRiskLevel): boolean {
  return RISK_LEVEL_ORDER[level] >= RISK_LEVEL_ORDER[threshold]
}

/**
 * The single place where a category becomes a verdict.
 *
 * `relaxed` loosens one rung, `strict` tightens one rung, and both are clamped
 * to the category's floor/ceiling. Nothing here can reach past `block` or
 * below `allow`, so an unknown strictness value is safe: it resolves to the
 * documented default rather than to "no policy".
 */
export function resolveSafetyDecision(
  category: SafetyCategory,
  strictness: SafetyStrictness = DEFAULT_SAFETY_STRICTNESS,
): SafetyDecision {
  const profile = SAFETY_CATEGORY_PROFILES[category]
  const shift = strictness === 'relaxed' ? -1 : strictness === 'strict' ? 1 : 0
  const floor = decisionRank(profile.floor)
  const ceiling = decisionRank(profile.ceiling)
  const wanted = decisionRank(profile.decision) + shift
  return DECISION_LADDER[Math.min(Math.max(wanted, floor), ceiling)]
}
