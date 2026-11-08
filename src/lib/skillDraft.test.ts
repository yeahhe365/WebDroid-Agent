import { describe, expect, it } from 'vitest'
import { draftSkill, formatSkillForPrompt } from './skillDraft'

const steps = (...names: string[]) =>
  names.map((action) => ({ action, summary: `${action} done`, success: true, app: '设置' }))

describe('skill drafting', () => {
  it('drafts a recipe from a run that touched the screen', () => {
    const skill = draftSkill({
      task: '打开设置并进入 Wi-Fi',
      steps: steps('launch', 'tap', 'tap'),
      now: 1_700_000_000_000,
    })

    expect(skill?.title).toBe('打开设置并进入 Wi-Fi')
    expect(skill?.steps).toHaveLength(3)
    expect(skill?.app).toBe('设置')
    expect(skill?.id).toMatch(/^skill-/)
  })

  it('refuses a run with too few real actions', () => {
    expect(draftSkill({ task: '看下天气', steps: steps('launch', 'tap') })).toBeNull()
  })

  it('ignores steps that never touch the screen', () => {
    const skill = draftSkill({
      task: '打开设置并进入 Wi-Fi',
      steps: [
        ...steps('launch', 'tap'),
        { action: 'note', summary: 'remembered', success: true },
        { action: 'wait', summary: 'waited', success: true },
        { action: 'done', summary: 'finished', success: true },
        { action: 'tap', summary: 'opened', success: true },
      ],
    })

    expect(skill?.steps).toHaveLength(3)
  })

  it('drops the failed step that ended the run', () => {
    const skill = draftSkill({
      task: '打开设置并进入 Wi-Fi',
      steps: [
        ...steps('launch', 'tap', 'tap'),
        { action: 'tap', summary: 'failed', success: false },
      ],
    })

    expect(skill?.steps).toHaveLength(3)
  })

  it('refuses a draft that would carry a secret into later prompts', () => {
    expect(
      draftSkill({
        task: '登录并查看订单',
        steps: [
          ...steps('launch', 'tap'),
          { action: 'input_text', summary: '密码是 abc12345', success: true },
        ],
      }),
    ).toBeNull()
  })

  it('has no draft without a task', () => {
    expect(draftSkill({ task: '   ', steps: steps('launch', 'tap', 'tap') })).toBeNull()
  })

  it('keeps one line per step', () => {
    const skill = draftSkill({
      task: '打开设置',
      steps: [
        { action: 'launch', summary: 'first line\nsecond line', success: true },
        { action: 'tap', summary: 'ok', success: true },
        { action: 'tap', summary: 'ok', success: true },
      ],
    })

    expect(skill?.steps[0]).toBe('launch: first line')
    expect(skill?.steps.join('\n')).not.toContain('second line')
  })

  it('formats a skill as a numbered prompt block', () => {
    const skill = draftSkill({
      task: '打开设置并进入 Wi-Fi',
      steps: steps('launch', 'tap', 'tap'),
    })

    const block = formatSkillForPrompt(skill!)

    expect(block).toContain('打开设置并进入 Wi-Fi')
    expect(block).toContain('1. launch')
    expect(block).toContain('3. tap')
  })
})
