import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'

/**
 * Why a ref from an earlier step cannot be used against the latest dump.
 *
 * - `ref_unknown`: this stabilizer never issued that ref (typo, garbage, or a ref from another run).
 * - `ref_retired`: the ref exists, but its element is gone from the latest dump or was re-numbered
 *   because it moved, changed identity, or lost its place in the traversal order.
 * - `element_moved`: the element named by the ref is still identifiable in the latest dump, but it is
 *   further from where the ref last saw it than the movement threshold allows.
 * - `ref_not_in_snapshot`: the ref is one of ours (its number is within the issued range) but no
 *   retained dump contains it any more — it is older than the `historyLimit` window, so its centres
 *   were evicted and it cannot be positioned against the latest dump.
 */
export type StaleCause = 'ref_unknown' | 'ref_retired' | 'element_moved' | 'ref_not_in_snapshot'

/** Result of translating a ref into a node of the latest dump. */
export type ElementRefResolution =
  | {
      status: 'ok'
      ref: string
      node: ScreenTreeNode
      center: { x: number; y: number }
      relocated: boolean
    }
  | { status: 'stale'; ref: string; cause: StaleCause }

/**
 * One or two sentences for the system prompt. Refs are the model-facing handle for an element; the
 * node `index` is re-assigned on every dump, the ref is not.
 */
export const REF_PROMPT_HINT = [
  'Element refs (e1, e2, …) stay the same across steps while the element is still on screen, so name elements by ref instead of by node index or pixel centre.',
  'A ref expires when its element disappears or moves; if a tool reports a stale ref, read the screen tree again and use the new ref instead of retrying the old one.',
].join(' ')

const DEFAULT_MAX_SHIFT_RATIO = 0.02
const DEFAULT_HISTORY_LIMIT = 20
/** Share of the shared labelled elements that must stay put for the whole screen to count as stationary. */
const STATIONARY_SHARE = 0.8
/** Field separator inside an identity key; a real attribute value cannot contain it. */
const KEY_SEPARATOR = '\u0000'
const REF_PATTERN = /^e([1-9]\d*)$/

type NodePosition = { x: number; y: number; known: boolean }

type NodeView = {
  index: number
  key: string
  identifiable: boolean
  labelled: boolean
  context: string | null
  position: NodePosition
  node: ScreenTreeNode
}

type DumpRecord = {
  number: number
  packageName?: string
  tolerance: number
  views: NodeView[]
  viewsByKey: Map<string, NodeView[]>
  refsByIndex: Map<number, string>
  /** ref -> centre of that ref in this dump; the bounded centre history lives here. */
  entries: Map<string, { node: ScreenTreeNode; position: NodePosition }>
}

type RefRecord = {
  key: string
  identifiable: boolean
  bornAt: number
  lastSeenAt: number
  position: NodePosition
  packageName?: string
}

/**
 * Assigns stable refs like e1, e2 … to nodes across successive dumps of the same screen.
 *
 * A node keeps its ref only when all of the following hold between two dumps:
 * - its identity key (className + resourceId + text + contentDescription) is unique in both dumps;
 * - the screen package did not change (taken from the first node that reports one; unknown counts as
 *   unchanged, so an unparsed package never alone breaks stability);
 * - its centre did not move more than `maxShiftRatio` of the screen short side;
 * - the nearest preceding labelled node (its "context") is the same — unless the whole screen is
 *   stationary within the same threshold, which tolerates context churn on carousels and counters.
 *
 * A node with no text, no contentDescription and no resourceId cannot be recognised and always gets a
 * fresh ref. Refs are monotonic and never reused after retirement; a ref missing from the latest dump
 * is retired. Only the last `historyLimit` dumps' centres are kept, so memory stays bounded.
 */
export class ElementRefStabilizer {
  private readonly maxShiftRatio: number
  private readonly historyLimit: number
  private readonly dumps: DumpRecord[] = []
  private readonly records = new Map<string, RefRecord>()
  private issuedCount = 0
  private dumpCount = 0

  constructor(options: { maxShiftRatio?: number; historyLimit?: number } = {}) {
    this.maxShiftRatio = normalizeMaxShiftRatio(options.maxShiftRatio)
    this.historyLimit = normalizeHistoryLimit(options.historyLimit)
  }

  /** e.g. `s3` — the `s` prefix belongs to this stabilizer (one per tool run) plus a dump counter. */
  get snapshotId(): string {
    return `s${this.dumpCount}`
  }

  /** Registers a dump and returns the ref of each node index in it. */
  next(tree: DeviceScreenTree): ReadonlyMap<number, string> {
    this.dumpCount += 1
    const nodes = tree?.nodes ?? []
    const views = buildViews(nodes)
    const viewsByKey = groupViewsByKey(views)
    const tolerance = screenShortSide(nodes) * this.maxShiftRatio
    const packageName = firstPackageName(nodes)

    const previous = this.latestDump
    const sameScreen = previous !== undefined && samePackage(previous.packageName, packageName)
    const stationary = previous !== undefined && isStationary(previous.views, views, tolerance)

    const refsByIndex = new Map<number, string>()
    const entries = new Map<string, { node: ScreenTreeNode; position: NodePosition }>()

    for (const view of views) {
      const carried =
        sameScreen && previous !== undefined
          ? carriedRef(view, previous, viewsByKey, stationary, tolerance)
          : undefined
      const ref = carried ?? this.allocateRef()
      refsByIndex.set(view.index, ref)
      entries.set(ref, { node: view.node, position: view.position })
      const born = this.records.get(ref)?.bornAt ?? this.dumpCount
      this.records.set(ref, {
        key: view.key,
        identifiable: view.identifiable,
        bornAt: born,
        lastSeenAt: this.dumpCount,
        position: view.position,
        ...(packageName === undefined ? {} : { packageName }),
      })
    }

    this.dumps.push({
      number: this.dumpCount,
      ...(packageName === undefined ? {} : { packageName }),
      tolerance,
      views,
      viewsByKey,
      refsByIndex,
      entries,
    })
    while (this.dumps.length > this.historyLimit) {
      this.dumps.shift()
    }
    this.pruneRecords()
    return refsByIndex
  }

  /** Resolves a ref against the latest registered dump. */
  resolve(ref: string): ElementRefResolution {
    const latest = this.latestDump
    const match = REF_PATTERN.exec(ref.trim())
    if (latest === undefined || match === null) {
      return staleCause(ref, 'ref_unknown')
    }
    const number = Number(match[1])
    if (number > this.issuedCount) {
      return staleCause(ref, 'ref_unknown')
    }
    const key = ref.trim()
    const entry = latest.entries.get(key)
    if (entry !== undefined) {
      const record = this.records.get(key)
      return {
        status: 'ok',
        ref: key,
        node: entry.node,
        center: { x: entry.position.x, y: entry.position.y },
        // The ref predates this dump: the model saw it on an earlier screen, the element held still.
        relocated: record !== undefined && record.bornAt < latest.number,
      }
    }
    const record = this.records.get(key)
    if (record === undefined) {
      // Number is within the issued range but no retained dump knows it: too old to position.
      return staleCause(ref, 'ref_not_in_snapshot')
    }
    if (movedBeyondTolerance(record, latest)) {
      return staleCause(ref, 'element_moved')
    }
    return staleCause(ref, 'ref_retired')
  }

  private get latestDump(): DumpRecord | undefined {
    return this.dumps.at(-1)
  }

  private allocateRef(): string {
    this.issuedCount += 1
    return `e${this.issuedCount}`
  }

  /** Drops refs that no retained dump mentions any more, so the history stays bounded. */
  private pruneRecords(): void {
    const retained = new Set<string>()
    for (const dump of this.dumps) {
      for (const ref of dump.entries.keys()) {
        retained.add(ref)
      }
    }
    for (const ref of [...this.records.keys()]) {
      if (!retained.has(ref)) {
        this.records.delete(ref)
      }
    }
  }
}

function staleCause(ref: string, cause: StaleCause): ElementRefResolution {
  return { status: 'stale', ref, cause }
}

/** The ref of the same element in the previous dump, or undefined when it cannot be recognised. */
function carriedRef(
  view: NodeView,
  previous: DumpRecord,
  viewsByKey: Map<string, NodeView[]>,
  stationary: boolean,
  tolerance: number,
): string | undefined {
  if (!view.identifiable) {
    return undefined
  }
  const inNew = viewsByKey.get(view.key)
  if (inNew === undefined || inNew.length !== 1) {
    return undefined
  }
  const inPrevious = previous.viewsByKey.get(view.key)
  if (inPrevious === undefined || inPrevious.length !== 1) {
    return undefined
  }
  const before = inPrevious[0]
  if (!before.identifiable) {
    return undefined
  }
  if (centerDistance(before.position, view.position) > tolerance) {
    return undefined
  }
  if (view.context !== before.context && !stationary) {
    return undefined
  }
  return previous.refsByIndex.get(before.index)
}

/** True when the element named by a retired ref is still identifiable, just further away than allowed. */
function movedBeyondTolerance(record: RefRecord, latest: DumpRecord): boolean {
  if (!record.identifiable) {
    return false
  }
  if (!samePackage(record.packageName, latest.packageName)) {
    return false
  }
  const candidates = latest.viewsByKey.get(record.key)
  if (candidates === undefined || candidates.length !== 1) {
    return false
  }
  const shift = centerDistance(record.position, candidates[0].position)
  return Number.isFinite(shift) && shift > latest.tolerance
}

function buildViews(nodes: readonly ScreenTreeNode[]): NodeView[] {
  const views: NodeView[] = []
  let context: string | null = null
  nodes.forEach((node, position) => {
    const key = nodeIdentityKey(node)
    const labelled = hasLabel(node)
    views.push({
      index: Number.isInteger(node.index) ? node.index : position,
      key,
      identifiable: isIdentifiable(node),
      labelled,
      context,
      position: nodePosition(node),
      node,
    })
    if (labelled) {
      context = key
    }
  })
  return views
}

function groupViewsByKey(views: readonly NodeView[]): Map<string, NodeView[]> {
  const grouped = new Map<string, NodeView[]>()
  for (const view of views) {
    const list = grouped.get(view.key)
    if (list === undefined) {
      grouped.set(view.key, [view])
    } else {
      list.push(view)
    }
  }
  return grouped
}

/**
 * The whole screen counts as stationary when at least two labelled elements are unique in both dumps
 * and 80% of them did not move: scrolling and page changes fail this, carousels and counters pass.
 */
function isStationary(
  before: readonly NodeView[],
  after: readonly NodeView[],
  tolerance: number,
): boolean {
  const afterByKey = groupViewsByKey(after.filter((view) => view.labelled))
  let shared = 0
  let inPlace = 0
  for (const [key, list] of groupViewsByKey(before.filter((view) => view.labelled))) {
    const candidates = afterByKey.get(key)
    if (list.length !== 1 || candidates === undefined || candidates.length !== 1) {
      continue
    }
    shared += 1
    if (centerDistance(list[0].position, candidates[0].position) <= tolerance) {
      inPlace += 1
    }
  }
  return shared >= 2 && inPlace >= shared * STATIONARY_SHARE
}

function nodeIdentityKey(node: ScreenTreeNode): string {
  return [
    node.className ?? '',
    node.resourceId ?? '',
    node.text ?? '',
    node.contentDescription ?? '',
  ].join(KEY_SEPARATOR)
}

function hasLabel(node: ScreenTreeNode): boolean {
  return Boolean(node.text?.trim()) || Boolean(node.contentDescription?.trim())
}

function isIdentifiable(node: ScreenTreeNode): boolean {
  return hasLabel(node) || Boolean(node.resourceId?.trim())
}

function nodePosition(node: ScreenTreeNode): NodePosition {
  const bounds = node.bounds
  if (bounds === undefined) {
    return { x: 0, y: 0, known: false }
  }
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    known: true,
  }
}

/** Two dumps agree on the position when both are unplaced, disagree when only one is placed. */
function centerDistance(a: NodePosition, b: NodePosition): number {
  if (!a.known && !b.known) {
    return 0
  }
  if (!a.known || !b.known) {
    return Number.POSITIVE_INFINITY
  }
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Screen short side, inferred from the dump itself: the tree carries no screen size, so the far edge
 * of the widest/ tallest bounds stands in for it. A dump without bounds yields 0, i.e. no tolerance.
 */
function screenShortSide(nodes: readonly ScreenTreeNode[]): number {
  let width = 0
  let height = 0
  for (const node of nodes) {
    const bounds = node.bounds
    if (bounds === undefined) {
      continue
    }
    width = Math.max(width, bounds.right, bounds.left, 0)
    height = Math.max(height, bounds.bottom, bounds.top, 0)
  }
  return Math.min(width, height)
}

function firstPackageName(nodes: readonly ScreenTreeNode[]): string | undefined {
  for (const node of nodes) {
    const packageName = node.packageName
    if (packageName !== undefined && packageName !== '') {
      return packageName
    }
  }
  return undefined
}

function samePackage(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || a === '' || b === undefined || b === '') {
    return true
  }
  return a === b
}

function normalizeMaxShiftRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_SHIFT_RATIO
  }
  return Math.min(value, 1)
}

function normalizeHistoryLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_HISTORY_LIMIT
  }
  return Math.max(1, Math.floor(value))
}
