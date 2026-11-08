import { describe, expect, it } from 'vitest'
import { findLimitNotice, isLimitNoticeText, LIMIT_NOTICE_MAX_CHARS } from './limitNotice'

describe('limit notices', () => {
  it('recognises a quota line in both languages', () => {
    expect(isLimitNoticeText('今日次数已用完，明天再来')).toBe(true)
    expect(isLimitNoticeText("You've reached today's limit")).toBe(true)
    expect(isLimitNoticeText('Too Many Requests')).toBe(true)
  })

  it('matches a phrase with a few characters in the middle', () => {
    expect(isLimitNoticeText('已达到沟通上限')).toBe(true)
  })

  it('ignores long paragraphs even when they mention a limit', () => {
    const long = `${'说明'.repeat(80)}次数已用完`

    expect(long.length).toBeGreaterThan(LIMIT_NOTICE_MAX_CHARS)
    expect(isLimitNoticeText(long)).toBe(false)
  })

  it('ignores unrelated text', () => {
    expect(isLimitNoticeText('设置')).toBe(false)
    expect(isLimitNoticeText('')).toBe(false)
  })

  it('reports only text that appeared after the action', () => {
    const before = ['消息', '今日次数已用完，明天再来']

    expect(findLimitNotice(before, [...before, '确定'])).toBeNull()
    expect(findLimitNotice(['消息'], ['消息', '操作太频繁，请稍后再试'])).toBe(
      '操作太频繁，请稍后再试',
    )
  })

  it('compares lines ignoring whitespace and case', () => {
    const before = ['You reached the daily limit']

    expect(findLimitNotice(before, ['you reached the   daily limit'])).toBeNull()
  })

  it('reads every line as new when the previous screen was unreadable', () => {
    expect(findLimitNotice(null, ['今天的机会已用完'])).toBe('今天的机会已用完')
  })

  it('returns null when nothing is new', () => {
    expect(findLimitNotice(['a'], ['a'])).toBeNull()
  })
})
