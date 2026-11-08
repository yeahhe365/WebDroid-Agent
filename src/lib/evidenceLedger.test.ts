import { describe, expect, it } from 'vitest'
import { EvidenceLedger, type EvidenceEntry } from './evidenceLedger'

describe('EvidenceLedger', () => {
  it('numbers entries in read order and reports emptiness', () => {
    const ledger = new EvidenceLedger()
    expect(ledger.isEmpty).toBe(true)

    const first = ledger.add({ kind: 'screen', text: '设置 已打开', step: 1 })
    const second = ledger.add({ kind: 'tool_result', text: '查询结果 空', step: 2, app: '设置' })

    expect(first).toEqual({ id: 1, kind: 'screen', text: '设置 已打开', step: 1 })
    expect(second).toEqual({ id: 2, kind: 'tool_result', text: '查询结果 空', app: '设置', step: 2 })
    expect(ledger.isEmpty).toBe(false)
    expect(ledger.entries.map((entry) => entry.id)).toEqual([1, 2])
  })

  it('drops an entry that is blank after normalisation', () => {
    const ledger = new EvidenceLedger()

    expect(ledger.add({ kind: 'screen', text: '   \n\t\n', step: 1 })).toBeNull()
    expect(ledger.add({ kind: 'screen', text: '\u200B\u200B', step: 1 })).toBeNull()
    expect(ledger.add({ kind: 'screen', text: '  有内容  ', step: 1 })?.text).toBe('有内容')
    expect(ledger.entries).toHaveLength(1)
  })

  it('replaces the same text instead of recording it twice', () => {
    const ledger = new EvidenceLedger()

    const first = ledger.add({ kind: 'screen', text: '设置 已打开', step: 1 })
    const second = ledger.add({ kind: 'screen', text: '设置  已打开 ', step: 5, app: '设置' })

    expect(ledger.entries).toHaveLength(1)
    expect(second?.id).toBeGreaterThan(first?.id ?? 0)
    expect(ledger.entries[0]).toMatchObject({ id: second?.id, step: 5, app: '设置' })
  })

  it('keeps the newest id when the same text comes back', () => {
    const ledger = new EvidenceLedger()
    ledger.add({ kind: 'screen', text: '搜索框 耳机', step: 1 })
    ledger.add({ kind: 'screen', text: '结果列表', step: 2 })
    const replaced = ledger.add({ kind: 'screen', text: '搜索框 耳机', step: 3 })

    expect(ledger.entries.map((entry) => entry.text)).toEqual(['结果列表', '搜索框 耳机'])
    expect(ledger.entries.at(-1)?.id).toBe(replaced?.id)
    expect(ledger.entries.at(-1)?.step).toBe(3)
  })

  it('drops the oldest entries once the character cap is exceeded', () => {
    const ledger = new EvidenceLedger({ capChars: 20 })

    ledger.add({ kind: 'screen', text: '0123456789', step: 1 })
    ledger.add({ kind: 'screen', text: 'abcdefghij', step: 2 })
    ledger.add({ kind: 'screen', text: 'ABCDEFGHIJ', step: 3 })

    expect(ledger.entries.map((entry) => entry.text)).toEqual(['abcdefghij', 'ABCDEFGHIJ'])
  })

  it('clips each kind to its own budget', () => {
    const ledger = new EvidenceLedger()

    const screen = ledger.add({ kind: 'screen', text: 'y'.repeat(7_000), step: 1 })
    const toolResult = ledger.add({
      kind: 'tool_result',
      text: `start${'x'.repeat(9_990)}end`,
      step: 2,
    })

    expect(screen?.text.length).toBe(6_000)
    expect(screen?.text.endsWith('[truncated]')).toBe(true)
    expect(toolResult?.text.length).toBeLessThanOrEqual(4_000)
    expect(toolResult?.text.startsWith('start')).toBe(true)
    expect(toolResult?.text.endsWith('end')).toBe(true)
  })

  it('selects the entry sharing a value with the answer plus the recent reads', () => {
    const ledger = new EvidenceLedger()
    ledger.add({ kind: 'screen', text: '订单 1,234 已发货', step: 1 })
    ledger.add({ kind: 'screen', text: '推荐商品 耳机', step: 2 })
    ledger.add({ kind: 'tool_result', text: '物流查询 无结果', step: 3 })
    ledger.add({ kind: 'user', text: '帮我看看物流', step: 4 })

    const selected = ledger.selectForAnswer('订单 1,234 什么时候到？')

    expect(selected.map((entry) => entry.step)).toEqual([1, 3, 4])
    expect(selected[0].text).toContain('1,234')
  })

  it('honours the limit without losing the supporting entry', () => {
    const ledger = new EvidenceLedger()
    for (let step = 1; step <= 6; step += 1) {
      const text = step === 2 ? '订单 9,876 已签收' : `第 ${step} 步 页面 ${step}`
      ledger.add({ kind: 'screen', text, step })
    }

    const selected = ledger.selectForAnswer('订单 9,876 到哪了', { limit: 2 })

    expect(selected).toHaveLength(2)
    expect(selected[0].text).toContain('9,876')
    expect(selected[1].step).toBe(6)
  })

  it('never exposes the internal entry list', () => {
    const ledger = new EvidenceLedger()
    ledger.add({ kind: 'screen', text: '设置 已打开', step: 1 })

    const entries = ledger.entries as EvidenceEntry[]
    entries.pop()
    entries.push({ id: 99, kind: 'user', text: '伪造', step: 9 })

    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0].id).toBe(1)
  })

  it('returns a copy from add, so callers cannot rewrite history', () => {
    const ledger = new EvidenceLedger()
    const entry = ledger.add({ kind: 'screen', text: '设置 已打开', step: 1 })

    if (entry) {
      entry.text = '改过的文字'
    }

    expect(ledger.entries[0].text).toBe('设置 已打开')
  })
})
