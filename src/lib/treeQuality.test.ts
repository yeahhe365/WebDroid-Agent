import { describe, expect, it } from 'vitest'
import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'
import {
  assessTreeQuality,
  hasBlindArea,
  promptNodeLimit,
  treeQualityPromptNote,
} from './treeQuality'

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

const named = (text: string, bounds?: ScreenTreeNode['bounds']) =>
  node({ text, ...(bounds ? { bounds } : {}) })

describe('tree quality', () => {
  it('treats a missing tree as unusable', () => {
    expect(assessTreeQuality(undefined)).toEqual({ quality: 'unusable', reason: 'empty_tree' })
    expect(assessTreeQuality(tree())).toEqual({ quality: 'unusable', reason: 'empty_tree' })
  })

  it('accepts a screen with enough named nodes', () => {
    const check = assessTreeQuality(
      tree(...Array.from({ length: 8 }, (_, index) => named(`item ${index}`))),
    )

    expect(check).toEqual({ quality: 'adequate' })
    expect(treeQualityPromptNote(check)).toBeNull()
  })

  it('flags controls that carry no readable name', () => {
    const check = assessTreeQuality(
      tree(
        node({ clickable: true }),
        node({ clickable: true }),
        node({ clickable: true }),
        node({ clickable: true, text: 'ok' }),
      ),
    )

    expect(check.quality).toBe('partial')
    expect(check.reason).toBe('unlabeled_controls')
    expect(treeQualityPromptNote(check)).toContain('many controls carry no text')
  })

  it('calls a tree with no text at all unusable', () => {
    expect(assessTreeQuality(tree(node({ clickable: true }), node()))).toEqual({
      quality: 'unusable',
      reason: 'no_text',
    })
  })

  it('does not accept a resource id as a name', () => {
    const check = assessTreeQuality(
      tree(
        node({ clickable: true, resourceId: 'app:id/a' }),
        node({ clickable: true, resourceId: 'app:id/b' }),
        node({ clickable: true, resourceId: 'app:id/c' }),
        node({ clickable: true, resourceId: 'app:id/d' }),
      ),
    )

    expect(check.reason).toBe('unlabeled_controls')
  })

  it('treats a large nameless clickable region as a blind area', () => {
    const screen = { left: 0, top: 0, right: 1000, bottom: 1000 }
    const canvas = node({ clickable: true, bounds: screen })
    const check = assessTreeQuality(tree(canvas, named('hello'), named('world')))

    expect(hasBlindArea(tree(canvas, named('hello'), named('world')).nodes)).toBe(true)
    expect(check.reason).toBe('blind_area')
  })

  it('does not call a container blind when named nodes sit inside it', () => {
    const screen = { left: 0, top: 0, right: 1000, bottom: 1000 }
    const plate = node({ clickable: true, bounds: screen })
    const inside = (text: string) =>
      named(text, { left: 10, top: 10, right: 200, bottom: 60 })
    const nodes = tree(plate, inside('one'), inside('two'), inside('three'))

    expect(hasBlindArea(nodes.nodes)).toBe(false)
  })

  it('spends a bigger node budget on a poor tree', () => {
    const poor = assessTreeQuality(tree(node({ clickable: true }), node({ clickable: true })))
    const good = assessTreeQuality(
      tree(...Array.from({ length: 8 }, (_, index) => named(`item ${index}`))),
    )

    expect(promptNodeLimit(poor)).toBeGreaterThan(promptNodeLimit(good))
  })

  it('explains an empty tree in the prompt note', () => {
    expect(treeQualityPromptNote(assessTreeQuality(undefined))).toContain('the tree is empty')
  })
})
