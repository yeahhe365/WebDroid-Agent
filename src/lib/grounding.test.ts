import { describe, expect, it } from 'vitest'
import { checkGrounding } from './grounding'

describe('checkGrounding', () => {
  it('passes an answer whose quotes, numbers and dates were all read', () => {
    const evidence = ['购物车\n无线降噪耳机\n单价 899 元\n预计 2026-11-08 送达']
    const answer = '购物车里的商品是「无线降噪耳机」，单价 899 元，结算页显示 2026-11-08 送达。'

    const result = checkGrounding(answer, evidence)

    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.checkedValues).toBeGreaterThanOrEqual(3)
  })

  it('flags a number nobody saw', () => {
    const result = checkGrounding('总价 1,299 元', ['购物车\n总价 899 元'])

    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({ kind: 'number', value: '1299' })
    expect(result.violations[0].reason).toContain('1299')
  })

  it('flags a quote nobody saw', () => {
    const result = checkGrounding('页面写着「会员专享五折」', ['页面写着「会员专享」'])

    expect(result.ok).toBe(false)
    expect(result.violations.map((violation) => violation.kind)).toEqual(['quote'])
    expect(result.violations[0].value).toBe('会员专享五折')
  })

  it('never checks a two-digit integer without a unit', () => {
    const result = checkGrounding('这条商品有 12 条评论', ['这条商品有 9 条评论'])

    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.checkedValues).toBe(0)
  })

  it('treats thousands separators as spelling, not as a different value', () => {
    const spaced = checkGrounding('销量 1,234 件', ['销量 1234 件'])
    const bare = checkGrounding('销量 1234 件', ['销量 1,234 件'])

    expect(spaced.ok).toBe(true)
    expect(bare.ok).toBe(true)
    expect(spaced.checkedValues).toBe(1)
    expect(bare.checkedValues).toBe(1)
  })

  it('folds 万 and 亿 magnitudes on both sides', () => {
    expect(checkGrounding('热度 1561 万', ['热度 15610000']).ok).toBe(true)
    expect(checkGrounding('热度 15610000', ['热度 1,561万']).ok).toBe(true)
    expect(checkGrounding('预约 1.5万 人', ['预约 15000 人']).ok).toBe(true)
    expect(checkGrounding('预约 2.5万 人', ['预约 15000 人']).ok).toBe(false)
  })

  it('finds a date written in another layout', () => {
    const result = checkGrounding('活动结束于 11月8日', ['活动结束日期 2026年11月8日'])

    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('checks the time of day as well as the date', () => {
    expect(checkGrounding('14:05 出发', ['出发时间 14:05']).ok).toBe(true)
    expect(checkGrounding('14:09 出发', ['出发时间 14:05']).violations.map((v) => v.kind)).toEqual([
      'date',
    ])
  })

  it('flags a date nobody saw', () => {
    const result = checkGrounding('活动结束于 11月9日', ['活动结束日期 2026年11月8日'])

    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([
      { kind: 'date', value: '11月9日', reason: expect.stringContaining('11月9日') },
    ])
  })

  it('ignores markdown emphasis and code markers around a value', () => {
    const result = checkGrounding('**价格**：`899` 元', ['价格：899 元'])

    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('ignores citation markers such as [1] and 【2】', () => {
    expect(checkGrounding('销量 3,000 台[1]', ['销量 3000 台']).ok).toBe(true)
    expect(checkGrounding('销量 3000 台【2】', ['销量 3,000 台']).ok).toBe(true)
    expect(checkGrounding('销量 3000 台[^12]', ['销量 3000 台']).ok).toBe(true)
  })

  it('does not treat ordinals, ranks and list numbers as values', () => {
    const answer = '第3条评论、前5名、Top 5 榜单、No.5、#2 推荐\n1. 客服态度很好'
    const result = checkGrounding(answer, ['空白页面'])

    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.checkedValues).toBe(0)
  })

  it('requires every piece of an elided quote on the same evidence line', () => {
    const answer = '页面写着「今日销量 1,234 … 环比上升」'
    const sameLine = checkGrounding(answer, ['今日销量 1,234 件，环比上升 12%'])
    const splitLines = checkGrounding(answer, ['今日销量 1,234 件', '环比上升 12%'])

    expect(sameLine.violations).toEqual([])
    expect(splitLines.ok).toBe(false)
    expect(splitLines.violations.map((violation) => violation.kind)).toEqual(['quote'])
  })

  it('counts distinct values once, however often the answer repeats them', () => {
    const result = checkGrounding('总价 899 元，优惠后仍是 899 元', ['总价 899 元'])

    expect(result.ok).toBe(true)
    expect(result.checkedValues).toBe(1)
  })

  it('caps violations but still counts every checked value', () => {
    const answer = Array.from({ length: 15 }, (_, index) => `商品${index + 1} ${1000 + index} 元`).join('，')

    const result = checkGrounding(answer, ['空白页面'], { maxViolations: 3 })

    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(3)
    expect(result.checkedValues).toBe(15)
  })

  it('checks a short number when it carries a unit', () => {
    const result = checkGrounding('续航 12 GB', ['续航 8 GB'])

    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([
      { kind: 'number', value: '12', reason: expect.stringContaining('whole token') },
    ])
  })

  it('does not accept a number that only appears inside an identifier', () => {
    const result = checkGrounding('型号 7541 有货', ['型号 G7541 有货'])

    expect(result.ok).toBe(false)
    expect(result.violations.map((violation) => violation.value)).toEqual(['7541'])
  })

  it('treats an answer with nothing checkable as grounded', () => {
    const result = checkGrounding('好的，我帮你看看。', [])

    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.checkedValues).toBe(0)
  })
})
