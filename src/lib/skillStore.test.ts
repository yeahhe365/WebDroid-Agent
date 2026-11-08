import { describe, expect, it } from 'vitest'
import {
  formatSkillsForPrompt,
  loadSkills,
  matchSkills,
  MAX_SKILLS,
  saveSkills,
  upsertSkill,
} from './skillStore'
import type { DraftedSkill } from './skillDraft'

function memoryStorage(initial?: string) {
  const store = new Map<string, string>()
  if (initial !== undefined) {
    store.set('webdroid-agent-skills', initial)
  }
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    raw: (key: string) => store.get(key),
  }
}

function skill(title: string, createdAt = 1): DraftedSkill {
  return {
    id: `skill-${title}`,
    title,
    whenToUse: title,
    steps: ['launch: 设置', 'tap: Wi-Fi'],
    createdAt,
  }
}

describe('skill store', () => {
  it('round-trips skills through storage', () => {
    const storage = memoryStorage()

    expect(saveSkills([skill('打开设置并进入 Wi-Fi')], storage)).toBe(true)
    expect(loadSkills(storage)).toHaveLength(1)
  })

  it('treats a broken or missing payload as empty', () => {
    expect(loadSkills(memoryStorage())).toEqual([])
    expect(loadSkills(memoryStorage('{not json'))).toEqual([])
    expect(loadSkills(memoryStorage('{"a":1}'))).toEqual([])
  })

  it('survives storage that refuses to read or write', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }

    expect(loadSkills(hostile)).toEqual([])
    expect(saveSkills([skill('x')], hostile)).toBe(false)
  })

  it('replaces a skill with the same title instead of duplicating it', () => {
    const first = skill('打开设置并进入 Wi-Fi')
    const updated = { ...first, createdAt: 2, steps: ['launch: 设置'] }
    const result = upsertSkill([first], updated)

    expect(result).toHaveLength(1)
    expect(result[0].steps).toEqual(['launch: 设置'])
  })

  it('keeps the newest skills and drops the oldest beyond the cap', () => {
    let skills: DraftedSkill[] = []
    for (let index = 0; index < MAX_SKILLS + 5; index += 1) {
      skills = upsertSkill(skills, skill(`任务 ${index}`, index))
    }

    expect(skills).toHaveLength(MAX_SKILLS)
    expect(skills[0].title).toBe(`任务 ${MAX_SKILLS + 4}`)
  })

  it('matches a skill to a task that covers the same terms', () => {
    const skills = [skill('打开设置并进入 Wi-Fi'), skill('在小红书发一条笔记')]

    expect(matchSkills(skills, '打开设置进入 Wi-Fi 看看')).toEqual([skills[0]])
    expect(matchSkills(skills, '帮我订一张去上海的机票')).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    expect(matchSkills([skill('打开设置')], '   ')).toEqual([])
  })

  it('ranks by coverage and respects the limit', () => {
    const exact = skill('打开设置并进入 Wi-Fi', 1)
    const partial = skill('打开设置', 2)

    const matched = matchSkills([partial, exact], '打开设置并进入 Wi-Fi', 1)

    expect(matched).toEqual([exact])
  })

  it('formats matched skills inside the untrusted wrapper', () => {
    const block = formatSkillsForPrompt([skill('打开设置并进入 Wi-Fi')])

    expect(block).toContain('<skills>')
    expect(block).toContain('<untrusted>')
    expect(block).toContain('1. launch: 设置')
    expect(formatSkillsForPrompt([])).toBeNull()
  })
})
