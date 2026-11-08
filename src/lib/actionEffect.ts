import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'
import { isEditableNode, isNamedNode } from './treeQuality'

/**
 * What an action actually did to the screen.
 *
 * Judged from the UI tree before and after the action — element table, control
 * state, input focus, which app is in front — and never from the picture alone.
 * The model is told the outcome, so "the tap changed nothing, try another way"
 * becomes evidence instead of guesswork, and a repeated tap at the same point
 * is visible in the log.
 */
export type ActionEffectKind = 'done' | 'small_change' | 'no_effect' | 'place_changed'

export type InterfaceDiff = {
  added: number
  removed: number
  moved: number
  edited: number
  toggled: number
  focusMoved: boolean
  total: number
  changes: number
  none: boolean
  major: boolean
}

/** Enough changed nodes to call it a screen change rather than a local twitch. */
export const EFFECT_MAJOR_MIN_CHANGES = 3
export const EFFECT_MAJOR_SHARE = 0.25
/** Two centres this close (share of the short side) are the same editable field. */
export const EFFECT_NEAR_RATIO = 0.05
/** Below this many meaningful nodes the trees cannot support a verdict either way. */
export const EFFECT_MIN_NODES = 2

/** Actions that can plausibly change what is on screen. */
export const UI_CHANGING_ACTIONS = new Set([
  'tap',
  'long_press',
  'double_tap',
  'swipe',
  'launch',
  'input_text',
  'type_secret',
  'open_url',
  'set_clipboard',
  'paste',
  'key',
  'back',
  'home',
  'sequence',
  'repeat',
])

type Keyed = {
  node: ScreenTreeNode
  key: string
  position: string
  center: { x: number; y: number } | null
  states: string
}

function isMeaningful(node: ScreenTreeNode) {
  // A focused field matters even when it has neither text nor a click handler:
  // focus moving is one of the clearest signs that an action landed.
  return isNamedNode(node) || Boolean(node.clickable || node.focusable || node.focused)
}

function centre(node: ScreenTreeNode) {
  if (!node.bounds) {
    return null
  }
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function keyed(node: ScreenTreeNode): Keyed {
  return {
    node,
    // The node index is deliberately absent: it is different on every dump.
    key: [
      node.className ?? '',
      node.text ?? '',
      node.contentDescription ?? '',
      node.resourceId ?? '',
    ].join('\u0000'),
    position: [
      node.className ?? '',
      node.resourceId ?? '',
      node.bounds ? `${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom}` : '',
    ].join('\u0000'),
    center: centre(node),
    states: [node.selected ? 's' : '', node.enabled === false ? 'd' : '', node.focused ? 'f' : ''].join(''),
  }
}

function pairOff<Left, Right>(
  left: Left[],
  right: Right[],
  matches: (a: Left, b: Right) => boolean,
) {
  let pairs = 0
  for (let index = left.length - 1; index >= 0; index -= 1) {
    const found = right.findIndex((candidate) => matches(left[index], candidate))
    if (found >= 0) {
      right.splice(found, 1)
      left.splice(index, 1)
      pairs += 1
    }
  }
  return pairs
}

function shortSide(tree: DeviceScreenTree) {
  let maxX = 0
  let maxY = 0
  for (const node of tree.nodes) {
    if (!node.bounds) {
      continue
    }
    maxX = Math.max(maxX, node.bounds.right)
    maxY = Math.max(maxY, node.bounds.bottom)
  }
  return Math.min(maxX, maxY)
}

export function diffScreenTrees(
  before: DeviceScreenTree,
  after: DeviceScreenTree,
): InterfaceDiff {
  const left = before.nodes.filter(isMeaningful).map(keyed)
  const right = after.nodes.filter(isMeaningful).map(keyed)
  const total = Math.max(left.length, right.length)
  const near = Math.max(1, shortSide(after) * EFFECT_NEAR_RATIO)

  pairOff(
    left,
    right,
    (a, b) => a.key === b.key && a.position === b.position && a.states === b.states,
  )
  const toggled = pairOff(
    left,
    right,
    (a, b) => a.key === b.key && a.position === b.position,
  )
  const moved = pairOff(left, right, (a, b) => a.key === b.key)
  // The same input field with different text: the text is part of the key, so
  // it has to be matched on class, id and position instead.
  const edited = pairOff(left, right, (a, b) => {
    if (!isEditableNode(a.node) || !isEditableNode(b.node)) {
      return false
    }
    if ((a.node.resourceId ?? '') !== (b.node.resourceId ?? '')) {
      return false
    }
    if ((a.node.className ?? '') !== (b.node.className ?? '')) {
      return false
    }
    return Boolean(a.center && b.center && distance(a.center, b.center) <= near)
  })

  const focusBefore = before.nodes.find((node) => node.focused)
  const focusAfter = after.nodes.find((node) => node.focused)
  // A focused node that merely scrolled keeps its identity: it is the same
  // field, so focus did not move.
  const focusMoved =
    Boolean(focusBefore) !== Boolean(focusAfter) ||
    (focusBefore !== undefined &&
      focusAfter !== undefined &&
      keyed(focusBefore).key !== keyed(focusAfter).key)

  const changes = right.length + left.length + moved + edited + toggled
  return {
    added: right.length,
    removed: left.length,
    moved,
    edited,
    toggled,
    focusMoved,
    total,
    changes,
    none: changes === 0 && !focusMoved,
    major:
      changes >= Math.max(EFFECT_MAJOR_MIN_CHANGES, Math.ceil(total * EFFECT_MAJOR_SHARE)),
  }
}

export type ActionEffect = {
  kind: ActionEffectKind
  diff: InterfaceDiff
  fromApp?: string
  toApp?: string
}

export type ClassifyActionEffectInput = {
  action: string
  before?: DeviceScreenTree
  after?: DeviceScreenTree
  beforeApp?: string
  beforePackage?: string
  afterApp?: string
  afterPackage?: string
}

function meaningfulCount(tree: DeviceScreenTree) {
  return tree.nodes.filter(isMeaningful).length
}

/**
 * The effect of `action`, or null when it cannot be judged: a tool that does not
 * touch the screen, or a tree too poor to compare (claiming "no effect" from a
 * tree that never had content would push the model into a pointless retry loop).
 */
export function classifyActionEffect({
  action,
  before,
  after,
  beforeApp,
  beforePackage,
  afterApp,
  afterPackage,
}: ClassifyActionEffectInput): ActionEffect | null {
  if (!UI_CHANGING_ACTIONS.has(action) || !before || !after) {
    return null
  }
  if (meaningfulCount(before) < EFFECT_MIN_NODES || meaningfulCount(after) < EFFECT_MIN_NODES) {
    return null
  }
  const diff = diffScreenTrees(before, after)
  const packageChanged =
    Boolean(beforePackage && afterPackage) && beforePackage !== afterPackage
  const appChanged = Boolean(beforeApp && afterApp) && beforeApp !== afterApp
  if (packageChanged || appChanged) {
    return {
      kind: 'place_changed',
      diff,
      ...(beforeApp ? { fromApp: beforeApp } : {}),
      ...(afterApp ? { toApp: afterApp } : {}),
    }
  }
  if (diff.none) {
    return { kind: 'no_effect', diff }
  }
  return { kind: diff.major ? 'done' : 'small_change', diff }
}

const EFFECT_GUIDANCE: Record<ActionEffectKind, string> = {
  done: 'The screen changed as expected.',
  small_change:
    'Only a small part of the screen changed. Take a fresh look before assuming the action landed.',
  no_effect:
    'Nothing on screen changed in response. Do not repeat the same point: pick a different target, scroll, or explain what blocked you.',
  place_changed:
    'A different app or page is now in front. Read the new screen before continuing.',
}

/** Prompt block describing the previous action's outcome; empty string when unknown. */
export function formatActionEffectForPrompt(
  effect: ActionEffect | null,
  previousAction?: string,
): string {
  if (!effect) {
    return ''
  }
  const details = [
    `action=${previousAction ?? 'unknown'}`,
    `changed=${effect.diff.changes}`,
    effect.diff.focusMoved ? 'focus_moved=true' : null,
    effect.fromApp && effect.toApp ? `from=${effect.fromApp} to=${effect.toApp}` : null,
  ].filter(Boolean)
  return [
    `<last_action_effect kind="${effect.kind}" ${details.join(' ')}>`,
    EFFECT_GUIDANCE[effect.kind],
    '</last_action_effect>',
  ].join('\n')
}
