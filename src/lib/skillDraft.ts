import { sensitiveCategory } from './sensitiveFilter'
import { truncateRetainedText } from './textRetention'

/**
 * Turning a run that worked into a skill: a short, ordered recipe that can be
 * put in front of the model next time, so a repeated task starts from a known
 * good path instead of being rediscovered step by step.
 *
 * Only a real trace earns a skill: a few actions that actually touched the
 * screen, none of them failed, and nothing secret in the text. A draft that
 * cannot be trusted is worse than no skill, because the model will follow it.
 */
export type SkillDraftStep = {
  action: string
  summary?: string
  app?: string
  success?: boolean
}

export type DraftedSkill = {
  id: string
  title: string
  whenToUse: string
  steps: string[]
  app?: string
  createdAt: number
}

/** Fewer real actions than this is a one-off, not a procedure. */
export const SKILL_MIN_STEPS = 3
export const SKILL_MAX_STEPS = 24
export const SKILL_TITLE_MAX = 60
export const SKILL_STEP_MAX = 160

/** Steps that do not touch the screen: they describe the run, they are not part of it. */
const NON_ACTION_STEPS = new Set(['note', 'wait', 'done', 'view_screenshot', 'take_over'])

function isUsableStep(step: SkillDraftStep) {
  if (NON_ACTION_STEPS.has(step.action) || step.success === false) {
    return false
  }
  return Boolean(step.action)
}

function describeStep(step: SkillDraftStep) {
  const summary = step.summary?.trim()
  const detail = summary ? truncateRetainedText(summary.split('\n')[0], SKILL_STEP_MAX, '…') : ''
  return truncateRetainedText(detail ? `${step.action}: ${detail}` : step.action, SKILL_STEP_MAX, '…')
}

function skillId(task: string, now: number) {
  let hash = 0x811c9dc5
  for (let index = 0; index < task.length; index += 1) {
    hash ^= task.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `skill-${hash.toString(16).padStart(8, '0')}-${now.toString(36)}`
}

export function draftSkill(input: {
  task: string
  steps: readonly SkillDraftStep[]
  now?: number
}): DraftedSkill | null {
  const task = input.task.trim()
  if (!task) {
    return null
  }
  const usable = input.steps.filter(isUsableStep).slice(0, SKILL_MAX_STEPS)
  if (usable.length < SKILL_MIN_STEPS) {
    return null
  }
  const steps = usable.map(describeStep)
  const title = truncateRetainedText(task.split('\n')[0], SKILL_TITLE_MAX, '…')
  const app = usable.find((step) => step.app)?.app
  // A skill is stored and replayed, so it must not carry a credential into
  // every later prompt.
  if (steps.some((step) => sensitiveCategory(step)) || sensitiveCategory(title)) {
    return null
  }
  const now = input.now ?? Date.now()
  return {
    id: skillId(task, now),
    title,
    whenToUse: truncateRetainedText(task, SKILL_TITLE_MAX * 3, '…'),
    steps,
    ...(app ? { app } : {}),
    createdAt: now,
  }
}

/** Prompt block for one skill. Kept short: it competes with the screen. */
export function formatSkillForPrompt(skill: DraftedSkill): string {
  return [
    `- ${skill.title}${skill.app ? ` (${skill.app})` : ''}`,
    ...skill.steps.map((step, index) => `  ${index + 1}. ${step}`),
  ].join('\n')
}
