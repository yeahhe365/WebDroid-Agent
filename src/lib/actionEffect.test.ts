import { describe, expect, it } from 'vitest'
import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'
import {
  classifyActionEffect,
  diffScreenTrees,
  formatActionEffectForPrompt,
} from './actionEffect'

let nextIndex = 0

function node(partial: Partial<ScreenTreeNode> = {}): ScreenTreeNode {
  nextIndex += 1
  return {
    index: nextIndex,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    ...partial,
  }
}

function tree(...nodes: ScreenTreeNode[]): DeviceScreenTree {
  return { nodes }
}

const label = (text: string, top = 0) =>
  node({ text, bounds: { left: 0, top, right: 100, bottom: top + 100 } })

const base = () => tree(label('首页', 0), label('消息', 120), label('我的', 240))

describe('interface diff', () => {
  it('sees no change when the tree is identical', () => {
    const diff = diffScreenTrees(base(), base())

    expect(diff.changes).toBe(0)
    expect(diff.none).toBe(true)
    expect(diff.major).toBe(false)
  })

  it('ignores node indexes, which change on every dump', () => {
    const diff = diffScreenTrees(base(), base())

    expect(diff.none).toBe(true)
  })

  it('counts a toggle separately from a structural change', () => {
    const after = tree(
      node({ text: '首页', selected: true }),
      label('消息', 120),
      label('我的', 240),
    )
    const diff = diffScreenTrees(base(), after)

    expect(diff.toggled).toBe(1)
    expect(diff.none).toBe(false)
  })

  it('counts a scrolled element as moved', () => {
    const after = tree(label('首页', 40), label('消息', 160), label('我的', 280))
    const diff = diffScreenTrees(base(), after)

    expect(diff.moved).toBe(3)
    expect(diff.added).toBe(0)
    expect(diff.removed).toBe(0)
  })

  it('counts new text in the same input field as edited', () => {
    const field = (text: string) =>
      node({
        className: 'android.widget.EditText',
        resourceId: 'app:id/search',
        text,
        bounds: { left: 0, top: 0, right: 200, bottom: 50 },
      })
    const before = tree(field('a'), label('搜索', 120))
    const after = tree(field('hello'), label('搜索', 120))
    const diff = diffScreenTrees(before, after)

    expect(diff.edited).toBe(1)
    expect(diff.added).toBe(0)
    expect(diff.removed).toBe(0)
  })

  it('notices when focus moved to another field', () => {
    const field = (id: string, focused: boolean) =>
      node({
        className: 'android.widget.EditText',
        resourceId: id,
        focused,
        bounds: { left: 0, top: 0, right: 200, bottom: 50 },
      })
    const diff = diffScreenTrees(
      tree(field('app:id/a', true), field('app:id/b', false)),
      tree(field('app:id/a', false), field('app:id/b', true)),
    )

    expect(diff.focusMoved).toBe(true)
    expect(diff.none).toBe(false)
  })

  it('does not move the verdict when a focused node only scrolled', () => {
    const field = (top: number, focused = true) =>
      node({
        className: 'android.widget.EditText',
        resourceId: 'app:id/a',
        focused,
        bounds: { left: 0, top, right: 200, bottom: top + 50 },
      })
    const diff = diffScreenTrees(tree(field(0)), tree(field(200)))

    expect(diff.focusMoved).toBe(false)
    expect(diff.moved).toBe(1)
  })
})

describe('action effect classification', () => {
  it('reports no effect when nothing changed', () => {
    const before = base()
    const effect = classifyActionEffect({
      action: 'tap',
      before,
      after: base(),
      beforeApp: '设置',
      afterApp: '设置',
    })

    expect(effect?.kind).toBe('no_effect')
  })

  it('reports a small change when only one element appeared', () => {
    const effect = classifyActionEffect({
      action: 'tap',
      before: base(),
      after: tree(label('首页', 0), label('消息', 120), label('我的', 240), label('新消息', 360)),
      beforeApp: '设置',
      afterApp: '设置',
    })

    expect(effect?.kind).toBe('small_change')
  })

  it('reports done when much of the screen changed', () => {
    const after = tree(
      label('搜索', 0),
      label('推荐', 120),
      label('直播', 240),
      label('购物', 360),
      label('我的', 480),
    )
    const effect = classifyActionEffect({
      action: 'tap',
      before: base(),
      after,
      beforeApp: '设置',
      afterApp: '设置',
    })

    expect(effect?.kind).toBe('done')
  })

  it('reports a place change when another app comes to the front', () => {
    const effect = classifyActionEffect({
      action: 'launch',
      before: base(),
      after: tree(label('收件箱', 0), label('已发送', 120)),
      beforeApp: '设置',
      beforePackage: 'com.android.settings',
      afterApp: '邮件',
      afterPackage: 'com.mail',
    })

    expect(effect?.kind).toBe('place_changed')
    expect(effect?.fromApp).toBe('设置')
    expect(effect?.toApp).toBe('邮件')
  })

  it('cannot judge a tree that has nothing meaningful in it', () => {
    expect(
      classifyActionEffect({
        action: 'tap',
        before: tree(),
        after: tree(label('首页')),
        beforeApp: 'a',
        afterApp: 'a',
      }),
    ).toBeNull()
  })

  it('does not judge tools that never touch the screen', () => {
    for (const action of ['note', 'wait', 'done', 'take_over', 'view_screenshot']) {
      expect(
        classifyActionEffect({
          action,
          before: base(),
          after: base(),
          beforeApp: 'a',
          afterApp: 'a',
        }),
      ).toBeNull()
    }
  })

  it('does not judge without both trees', () => {
    expect(
      classifyActionEffect({ action: 'tap', after: base(), beforeApp: 'a', afterApp: 'a' }),
    ).toBeNull()
  })
})

describe('action effect prompt block', () => {
  it('states the outcome and what to do about it', () => {
    const effect = classifyActionEffect({
      action: 'tap',
      before: base(),
      after: base(),
      beforeApp: '设置',
      afterApp: '设置',
    })
    const block = formatActionEffectForPrompt(effect, 'tap')

    expect(block).toContain('kind="no_effect"')
    expect(block).toContain('action=tap')
    expect(block).toContain('Do not repeat the same point')
  })

  it('is empty when the effect is unknown', () => {
    expect(formatActionEffectForPrompt(null, 'note')).toBe('')
  })
})
