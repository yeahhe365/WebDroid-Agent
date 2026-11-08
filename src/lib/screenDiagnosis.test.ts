import { describe, expect, it } from 'vitest'
import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'
import {
  classifyScreen,
  formatScreenStateForPrompt,
  screenFactsFrom,
  screenTexts,
  treeSignature,
} from './screenDiagnosis'

let nextIndex = 0

function node(partial: Partial<ScreenTreeNode> = {}): ScreenTreeNode {
  nextIndex += 1
  return { index: nextIndex, ...partial }
}

function tree(...nodes: ScreenTreeNode[]): DeviceScreenTree {
  return { nodes }
}

const facts = (
  overrides: Partial<Parameters<typeof classifyScreen>[0]> = {},
): Parameters<typeof classifyScreen>[0] => ({
  nodeCount: 10,
  namedCount: 8,
  ...overrides,
})

describe('screen diagnosis', () => {
  it('says normal for a readable ordinary screen', () => {
    expect(classifyScreen(facts())).toEqual({ state: 'normal', needsHuman: false })
  })

  it('asks for a human when a password field is present', () => {
    const check = classifyScreen(facts({ passwordField: true }))

    expect(check.state).toBe('needs_human')
    expect(check.needsHuman).toBe(true)
    expect(check.takeoverKind).toBe('login')
    expect(check.cause).toBe('password_field')
  })

  it('classifies captcha text before payment and login', () => {
    const check = classifyScreen(
      facts({ texts: ['请完成验证', '确认支付', '登录'] }),
    )

    expect(check.takeoverKind).toBe('captcha')
  })

  it('classifies payment text', () => {
    expect(classifyScreen(facts({ texts: ['确认支付 128 元'] })).takeoverKind).toBe('payment')
  })

  it('classifies a login screen from its words', () => {
    const check = classifyScreen(facts({ texts: ['手机号登录'] }))

    expect(check.state).toBe('needs_human')
    expect(check.takeoverKind).toBe('login')
    expect(check.cause).toBe('login_text')
  })

  it('reports a blank capture when the picture is black and nothing is readable', () => {
    const check = classifyScreen(facts({ nodeCount: 0, namedCount: 0, blackFrames: 2 }))

    expect(check.state).toBe('capture_unavailable')
    expect(check.cause).toBe('blank_capture_without_tree')
  })

  it('reports a protected screen when capture is black but the tree is readable', () => {
    const check = classifyScreen(
      facts({ nodeCount: 6, namedCount: 5, blackFrames: 2, texts: ['输入金额'] }),
    )

    expect(check.state).toBe('protected')
  })

  it('waits instead of giving up on the first empty read', () => {
    const check = classifyScreen(facts({ nodeCount: 0, namedCount: 0, unchangedRuns: 0 }))

    expect(check.state).toBe('loading')
  })

  it('calls a stable empty screen blank', () => {
    const check = classifyScreen(facts({ nodeCount: 0, namedCount: 0, unchangedRuns: 2 }))

    expect(check.state).toBe('blank')
  })

  it('builds facts from a tree', () => {
    const built = screenFactsFrom({
      tree: tree(
        node({ text: '消息' }),
        node({ contentDescription: '搜索' }),
        node({ className: 'android.widget.EditText' }),
        node({ className: 'android.widget.EditText', password: true }),
      ),
    })

    expect(built.nodeCount).toBe(4)
    expect(built.namedCount).toBe(2)
    expect(built.texts).toEqual(['消息', '搜索'])
    expect(built.passwordField).toBe(true)
  })

  it('collects screen text without duplicates', () => {
    expect(
      screenTexts(tree(node({ text: '设置' }), node({ contentDescription: '设置' }), node({ text: ' ' }))),
    ).toEqual(['设置'])
  })

  it('fingerprints a tree so identical dumps compare equal', () => {
    const a = tree(node({ text: 'a' }), node({ text: 'b' }))
    const b = tree(node({ text: 'a' }), node({ text: 'b' }))

    expect(treeSignature(a)).toBe(treeSignature(b))
    expect(treeSignature(a)).not.toBe(treeSignature(tree(node({ text: 'a' }))))
    expect(treeSignature(undefined)).toBe('')
  })

  it('says nothing in the prompt for a normal screen', () => {
    expect(formatScreenStateForPrompt({ state: 'normal', needsHuman: false })).toBe('')
  })

  it('tells the model to hand over instead of guessing at a blank capture', () => {
    const block = formatScreenStateForPrompt({
      state: 'capture_unavailable',
      needsHuman: false,
      cause: 'blank_capture_without_tree',
    })

    expect(block).toContain('state="capture_unavailable"')
    expect(block).toContain('take_over')
  })
})
