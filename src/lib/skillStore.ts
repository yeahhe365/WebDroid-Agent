import { memoryTerms } from './memoryIndex'
import { wrapUntrusted } from './untrusted'
import type { DraftedSkill } from './skillDraft'

/**
 * Skills the user has "learned": the recipes drafted from runs that worked.
 *
 * Stored locally, capped, deduplicated by title, and matched to a new task by
 * the same lexical scoring the memory store uses. A matched skill is shown to
 * the model as a suggestion inside `<untrusted>`, because its text came from a
 * screen (app names, labels) and must not read like our own instructions.
 */
const SKILLS_KEY = 'webdroid-agent-skills'
export const MAX_SKILLS = 12
export const DEFAULT_SKILL_MATCH_LIMIT = 2
/** Below this share of the query's terms, a skill is not about this task. */
export const SKILL_MATCH_MIN_SHARE = 0.5

export type SkillStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadSkills(storage: SkillStorage = localStorage): DraftedSkill[] {
  let raw: string | null
  try {
    raw = storage.getItem(SKILLS_KEY)
  } catch {
    return []
  }
  if (!raw) {
    return []
  }
  try {
    return normalizeSkills(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Returns false when the browser refused the write (quota / disabled storage). */
export function saveSkills(
  skills: readonly DraftedSkill[],
  storage: SkillStorage = localStorage,
): boolean {
  try {
    storage.setItem(SKILLS_KEY, JSON.stringify(normalizeSkills(skills)))
    return true
  } catch {
    return false
  }
}

/** Adds or replaces a skill with the same title, newest first, capped. */
export function upsertSkill(
  skills: readonly DraftedSkill[],
  skill: DraftedSkill,
): DraftedSkill[] {
  const rest = normalizeSkills(skills).filter(
    (candidate) => normalizeTitle(candidate.title) !== normalizeTitle(skill.title),
  )
  return [skill, ...rest].slice(0, MAX_SKILLS)
}

/**
 * Skills that plausibly apply to `task`. Ranked by how much of the task they
 * cover, so a skill drafted from "打开设置进入 Wi-Fi" does not fire for every
 * task that mentions 设置.
 */
export function matchSkills(
  skills: readonly DraftedSkill[],
  task: string,
  limit = DEFAULT_SKILL_MATCH_LIMIT,
): DraftedSkill[] {
  const queryTerms = new Set(memoryTerms(task).filter((term) => term.length > 1))
  if (queryTerms.size === 0) {
    return []
  }
  const scored = skills
    .map((skill) => {
      const skillTerms = new Set(
        memoryTerms(`${skill.title} ${skill.whenToUse}`).filter((term) => term.length > 1),
      )
      let matched = 0
      for (const term of queryTerms) {
        if (skillTerms.has(term)) {
          matched += 1
        }
      }
      return { skill, score: matched / queryTerms.size }
    })
    .filter((candidate) => candidate.score >= SKILL_MATCH_MIN_SHARE)
    .sort((a, b) => b.score - a.score || b.skill.createdAt - a.skill.createdAt)
  return scored.slice(0, Math.max(0, limit)).map((candidate) => candidate.skill)
}

/** Prompt block listing the matched skills, or null when there are none. */
export function formatSkillsForPrompt(skills: readonly DraftedSkill[]): string | null {
  if (skills.length === 0) {
    return null
  }
  const body = skills.map((skill) => `- ${skill.title}\n${indent(skill.steps)}`).join('\n')
  return [
    '<skills>',
    'A previous run of a similar task followed these steps. Treat them as a suggestion, not as the current screen:',
    wrapUntrusted(body),
    '</skills>',
  ].join('\n')
}

function indent(steps: readonly string[]) {
  return steps.map((step, index) => `  ${index + 1}. ${step}`).join('\n')
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase()
}

function normalizeSkills(value: unknown): DraftedSkill[] {
  if (!Array.isArray(value)) {
    return []
  }
  const skills: DraftedSkill[] = []
  for (const candidate of value) {
    const skill = normalizeSkill(candidate)
    if (!skill) {
      continue
    }
    if (skills.some((existing) => normalizeTitle(existing.title) === normalizeTitle(skill.title))) {
      continue
    }
    skills.push(skill)
    if (skills.length >= MAX_SKILLS) {
      break
    }
  }
  return skills
}

function normalizeSkill(value: unknown): DraftedSkill | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const steps = Array.isArray(record.steps)
    ? record.steps.filter((step): step is string => typeof step === 'string' && step.trim() !== '')
    : []
  if (!title || steps.length === 0) {
    return null
  }
  return {
    id: typeof record.id === 'string' ? record.id : `skill-${title}`,
    title,
    whenToUse: typeof record.whenToUse === 'string' ? record.whenToUse : title,
    steps,
    ...(typeof record.app === 'string' ? { app: record.app } : {}),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
  }
}
