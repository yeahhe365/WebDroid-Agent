import { describe, expect, it } from 'vitest'
import type { DeviceScreenTree, ScreenTreeNode, ScreenTreeBounds } from '../adapters/uiAutomator'
import { ElementRefStabilizer, REF_PROMPT_HINT } from './elementRefs'

type BoundsTuple = [left: number, top: number, right: number, bottom: number]

function bounds(left: number, top: number, right: number, bottom: number): ScreenTreeBounds {
  return { left, top, right, bottom }
}

/** A 1000x1000 screen, so the default 2% threshold is exactly 20px. */
function screenNode(
  index: number,
  box: BoundsTuple,
  extra: Partial<ScreenTreeNode> = {},
): ScreenTreeNode {
  const [left, top, right, bottom] = box
  return { index, bounds: bounds(left, top, right, bottom), ...extra }
}

function rootNode(extra: Partial<ScreenTreeNode> = {}): ScreenTreeNode {
  return screenNode(0, [0, 0, 1000, 1000], {
    className: 'android.widget.FrameLayout',
    resourceId: 'com.example:id/root',
    text: 'Root',
    packageName: 'com.example.app',
    ...extra,
  })
}

function labelledNode(
  index: number,
  text: string,
  box: BoundsTuple,
  extra: Partial<ScreenTreeNode> = {},
): ScreenTreeNode {
  return screenNode(index, box, {
    className: 'android.widget.Button',
    resourceId: `com.example:id/${text.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    text,
    packageName: 'com.example.app',
    ...extra,
  })
}

function dump(...nodes: ScreenTreeNode[]): DeviceScreenTree {
  return { nodes }
}

function refAt(refs: ReadonlyMap<number, string>, index: number): string {
  const ref = refs.get(index)
  if (ref === undefined) {
    throw new Error(`no ref for node ${index}`)
  }
  return ref
}

function sortedEntries(refs: ReadonlyMap<number, string>) {
  return [...refs.entries()].sort((a, b) => a[0] - b[0])
}

describe('ElementRefStabilizer', () => {
  it('assigns monotonic refs to a first dump and exposes a snapshot id', () => {
    const stabilizer = new ElementRefStabilizer()
    expect(stabilizer.snapshotId).toBe('s0')

    const refs = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))

    expect(sortedEntries(refs)).toEqual([
      [0, 'e1'],
      [1, 'e2'],
    ])
    expect(stabilizer.snapshotId).toBe('s1')
  })

  it('keeps the same refs when the same tree is dumped twice', () => {
    const stabilizer = new ElementRefStabilizer()
    const tree = () =>
      dump(
        rootNode(),
        labelledNode(1, 'Open', [0, 0, 100, 100]),
        labelledNode(2, 'Close', [200, 0, 300, 100]),
      )

    const first = stabilizer.next(tree())
    const second = stabilizer.next(tree())

    expect(sortedEntries(second)).toEqual(sortedEntries(first))
    expect(stabilizer.snapshotId).toBe('s2')
  })

  it('keeps refs when the dump order changes but the screen stays put', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(
      dump(
        rootNode(),
        labelledNode(1, 'Open', [0, 0, 100, 100]),
        labelledNode(2, 'Close', [200, 0, 300, 100]),
      ),
    )

    const reordered = stabilizer.next(
      dump(
        labelledNode(2, 'Close', [200, 0, 300, 100]),
        labelledNode(1, 'Open', [0, 0, 100, 100]),
        rootNode(),
      ),
    )

    // The index -> ref mapping is independent of the order the nodes arrived in.
    expect(sortedEntries(reordered)).toEqual(sortedEntries(first))
  })

  it('gives a node a new ref when its text changes', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Skip 3', [0, 0, 100, 100])))
    const second = stabilizer.next(dump(rootNode(), labelledNode(1, 'Skip 2', [0, 0, 100, 100])))

    expect(refAt(second, 1)).not.toBe(refAt(first, 1))
    expect(stabilizer.resolve(refAt(first, 1))).toMatchObject({ status: 'stale' })
  })

  it('keeps the ref when a node moves within tolerance', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    // 10px on a 1000px short side is inside the default 2% (20px) threshold.
    const second = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [10, 0, 110, 100])))

    expect(refAt(second, 1)).toBe(refAt(first, 1))
    expect(stabilizer.resolve(refAt(first, 1))).toEqual({
      status: 'ok',
      ref: 'e2',
      node: expect.objectContaining({ index: 1, text: 'Open' }),
      center: { x: 60, y: 50 },
      relocated: true,
    })
  })

  it('gives a new ref and reports element_moved when a node moves beyond tolerance', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    // 30px > 20px threshold.
    const second = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [30, 0, 130, 100])))

    expect(refAt(second, 1)).not.toBe(refAt(first, 1))
    expect(stabilizer.resolve(refAt(first, 1))).toEqual({
      status: 'stale',
      ref: 'e2',
      cause: 'element_moved',
    })
  })

  it('gives fresh refs to nodes without text, description or resource id', () => {
    const stabilizer = new ElementRefStabilizer()
    const blank = (index: number) => screenNode(index, [0, 0, 100, 100], {
      className: 'android.widget.FrameLayout',
    })

    const first = stabilizer.next(dump(rootNode(), blank(1)))
    const second = stabilizer.next(dump(rootNode(), blank(1)))

    expect(refAt(second, 1)).not.toBe(refAt(first, 1))
    expect(stabilizer.resolve(refAt(first, 1))).toMatchObject({ status: 'stale' })
  })

  it('retires the ref of an element that disappears from the dump', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(
      dump(
        rootNode(),
        labelledNode(1, 'Open', [0, 0, 100, 100]),
        labelledNode(2, 'Close', [200, 0, 300, 100]),
      ),
    )
    const openRef = refAt(first, 1)
    const closeRef = refAt(first, 2)

    const second = stabilizer.next(
      dump(rootNode(), labelledNode(2, 'Close', [200, 0, 300, 100])),
    )

    expect(refAt(second, 2)).toBe(closeRef)
    expect(stabilizer.resolve(openRef)).toEqual({
      status: 'stale',
      ref: openRef,
      cause: 'ref_retired',
    })
  })

  it('reports ref_unknown for refs it never issued', () => {
    const stabilizer = new ElementRefStabilizer()
    expect(stabilizer.resolve('e1')).toEqual({
      status: 'stale',
      ref: 'e1',
      cause: 'ref_unknown',
    })

    stabilizer.next(dump(rootNode()))

    expect(stabilizer.resolve('e99')).toMatchObject({ cause: 'ref_unknown' })
    expect(stabilizer.resolve('e0')).toMatchObject({ cause: 'ref_unknown' })
    expect(stabilizer.resolve('not-a-ref')).toMatchObject({ cause: 'ref_unknown' })
  })

  it('resolves a ref issued two dumps ago as relocated', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    const openRef = refAt(first, 1)

    expect(stabilizer.resolve(openRef)).toMatchObject({ status: 'ok', relocated: false })

    const second = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    expect(refAt(second, 1)).toBe(openRef)
    expect(stabilizer.resolve(openRef)).toMatchObject({
      status: 'ok',
      relocated: true,
      center: { x: 50, y: 50 },
    })

    stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    expect(stabilizer.resolve(openRef)).toMatchObject({ status: 'ok', relocated: true })
  })

  it('resets matching when the package changes', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    const openRef = refAt(first, 1)

    const other = { packageName: 'com.other.app' }
    const second = stabilizer.next(
      dump(rootNode(other), labelledNode(1, 'Open', [0, 0, 100, 100], other)),
    )

    expect(refAt(second, 1)).not.toBe(openRef)
    expect(stabilizer.resolve(openRef)).toEqual({
      status: 'stale',
      ref: openRef,
      cause: 'ref_retired',
    })
  })

  it('treats an unknown package as unchanged', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(
      dump(
        screenNode(0, [0, 0, 1000, 1000], { className: 'android.widget.FrameLayout', text: 'Root' }),
        labelledNode(1, 'Open', [0, 0, 100, 100], { packageName: undefined }),
      ),
    )
    const second = stabilizer.next(
      dump(
        screenNode(0, [0, 0, 1000, 1000], { className: 'android.widget.FrameLayout', text: 'Root' }),
        labelledNode(1, 'Open', [0, 0, 100, 100], { packageName: undefined }),
      ),
    )

    expect(sortedEntries(second)).toEqual(sortedEntries(first))
  })

  it('handles an empty tree and retires everything it held', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    const openRef = refAt(first, 1)

    const empty = stabilizer.next(dump())

    expect(empty.size).toBe(0)
    expect(stabilizer.snapshotId).toBe('s2')
    expect(stabilizer.resolve(openRef)).toEqual({
      status: 'stale',
      ref: openRef,
      cause: 'ref_retired',
    })
  })

  it('keeps a ref for a node that never reports bounds, and drops it once bounds appear', () => {
    const stabilizer = new ElementRefStabilizer()
    const ghost = (index: number): ScreenTreeNode => ({
      index,
      className: 'android.widget.TextView',
      resourceId: 'com.example:id/ghost',
      text: 'Ghost',
      packageName: 'com.example.app',
    })

    const first = stabilizer.next(dump(rootNode(), ghost(1)))
    const second = stabilizer.next(dump(rootNode(), ghost(1)))

    expect(refAt(second, 1)).toBe(refAt(first, 1))
    expect(stabilizer.resolve(refAt(first, 1))).toEqual({
      status: 'ok',
      ref: 'e2',
      node: expect.objectContaining({ index: 1 }),
      center: { x: 0, y: 0 },
      relocated: true,
    })

    const placed = screenNode(1, [10, 10, 20, 20], {
      className: 'android.widget.TextView',
      resourceId: 'com.example:id/ghost',
      text: 'Ghost',
      packageName: 'com.example.app',
    })
    const third = stabilizer.next(dump(rootNode(), placed))

    expect(refAt(third, 1)).not.toBe(refAt(first, 1))
  })

  it('never reuses a ref after retirement', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    expect(refAt(first, 0)).toBe('e1')
    expect(refAt(first, 1)).toBe('e2')

    const second = stabilizer.next(dump(rootNode()))
    expect(refAt(second, 0)).toBe('e1')

    const third = stabilizer.next(
      dump(rootNode(), labelledNode(2, 'Fresh', [400, 400, 500, 500])),
    )
    const freshRef = refAt(third, 2)

    expect(freshRef).not.toBe('e2')
    expect(Number(freshRef.slice(1))).toBeGreaterThan(2)
  })

  it('caps the retained centre history but keeps the latest resolutions working', () => {
    const stabilizer = new ElementRefStabilizer({ historyLimit: 2 })
    const first = stabilizer.next(
      dump(
        rootNode(),
        labelledNode(1, 'Open', [0, 0, 100, 100]),
        labelledNode(2, 'Close', [200, 0, 300, 100]),
      ),
    )
    const openRef = refAt(first, 1)
    const closeRef = refAt(first, 2)

    for (let step = 0; step < 3; step += 1) {
      stabilizer.next(dump(rootNode(), labelledNode(2, 'Close', [200, 0, 300, 100])))
    }

    expect(stabilizer.snapshotId).toBe('s4')
    // Still on screen: the cap does not affect the live ref.
    expect(stabilizer.resolve(closeRef)).toMatchObject({ status: 'ok', relocated: true })
    // Ref retired three dumps ago: its centres were evicted, so it cannot be positioned any more.
    expect(stabilizer.resolve(openRef)).toEqual({
      status: 'stale',
      ref: openRef,
      cause: 'ref_not_in_snapshot',
    })
  })

  it('honours a custom maxShiftRatio', () => {
    const strict = new ElementRefStabilizer({ maxShiftRatio: 0.001 })
    const strictFirst = strict.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    const strictSecond = strict.next(dump(rootNode(), labelledNode(1, 'Open', [10, 0, 110, 100])))
    expect(refAt(strictSecond, 1)).not.toBe(refAt(strictFirst, 1))

    const loose = new ElementRefStabilizer({ maxShiftRatio: 0.1 })
    const looseFirst = loose.next(dump(rootNode(), labelledNode(1, 'Open', [0, 0, 100, 100])))
    const looseSecond = loose.next(dump(rootNode(), labelledNode(1, 'Open', [10, 0, 110, 100])))
    expect(refAt(looseSecond, 1)).toBe(refAt(looseFirst, 1))
  })

  it('retires a ref whose context changed on a moving screen', () => {
    const stabilizer = new ElementRefStabilizer()
    const first = stabilizer.next(
      dump(
        rootNode(),
        labelledNode(1, 'Open', [100, 100, 200, 200]),
        labelledNode(2, 'Close', [400, 400, 500, 500]),
        labelledNode(3, 'Menu', [600, 600, 700, 700]),
      ),
    )
    const openRef = refAt(first, 1)

    // A new labelled node is inserted before Open, and everything else shifts 30px (> 20px), so the
    // screen is not stationary and the changed context is not tolerated.
    const second = stabilizer.next(
      dump(
        screenNode(0, [30, 0, 1030, 1000], {
          className: 'android.widget.FrameLayout',
          resourceId: 'com.example:id/root',
          text: 'Root',
          packageName: 'com.example.app',
        }),
        labelledNode(4, 'Breadcrumb', [50, 100, 90, 140]),
        labelledNode(1, 'Open', [100, 100, 200, 200]),
        labelledNode(2, 'Close', [430, 400, 530, 500]),
        labelledNode(3, 'Menu', [630, 600, 730, 700]),
      ),
    )

    expect(refAt(second, 1)).not.toBe(openRef)
    // Open did not move, so it is not "element_moved": it simply lost its ref.
    expect(stabilizer.resolve(openRef)).toEqual({
      status: 'stale',
      ref: openRef,
      cause: 'ref_retired',
    })
  })

  it('describes the prompt hint without leaking implementation details', () => {
    expect(REF_PROMPT_HINT.length).toBeGreaterThan(40)
    expect(REF_PROMPT_HINT).toMatch(/ref/i)
    expect(REF_PROMPT_HINT).toMatch(/stale/i)
    expect(REF_PROMPT_HINT.toLowerCase()).toContain('e1')
  })
})
