import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'

/**
 * How much of the screen the UI tree actually describes.
 *
 * The agent always gets both the screenshot and the tree, so this does not
 * decide whether to look at the screen; it decides how much of the tree is
 * worth spending tokens on, and whether the model must be warned that the tree
 * is a partial picture. A tree with unlabeled controls or with a large blank
 * region (a canvas, a map, a page that renders into a WebView the dump cannot
 * read) is exactly the case where trusting node bounds alone goes wrong.
 */
export type TreeQuality = 'adequate' | 'partial' | 'unusable'

export type TreeQualityReason =
  | 'empty_tree'
  | 'unlabeled_controls'
  | 'no_text'
  | 'blind_area'

export type TreeQualityCheck = {
  quality: TreeQuality
  reason?: TreeQualityReason
}

/** Named controls below this count make the tree ambiguous rather than clearly good. */
export const TREE_ENOUGH_NAMED = 6
/** A clickable, nameless node covering this share of the screen is a blind region. */
export const TREE_BLIND_AREA_RATIO = 0.2
/** Named nodes inside that region mean it is a background plate, not a blind region. */
export const TREE_NAMED_INSIDE_MIN = 3
/** A tree with four or more controls where at most a third are named is missing labels. */
export const TREE_UNLABELED_SHARE = 3

/**
 * Node budget per quality. A poor tree gets MORE nodes, because the details are
 * all the model has; an adequate one is trimmed, because the screenshot already
 * shows what the extra nodes would repeat.
 */
export const TREE_PROMPT_NODE_LIMITS: Record<TreeQuality, number> = {
  adequate: 60,
  partial: 120,
  unusable: 160,
}

export function isEditableNode(node: ScreenTreeNode) {
  return /EditText|AutoCompleteTextView|SearchView|TextInput/i.test(node.className ?? '')
}

export function isNamedNode(node: ScreenTreeNode) {
  return Boolean(node.text?.trim() || node.contentDescription?.trim())
}

function area(bounds: ScreenTreeNode['bounds']) {
  if (!bounds) {
    return 0
  }
  return (
    Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
  )
}

function centerInside(node: ScreenTreeNode, bounds: NonNullable<ScreenTreeNode['bounds']>) {
  if (!node.bounds) {
    return false
  }
  const x = (node.bounds.left + node.bounds.right) / 2
  const y = (node.bounds.top + node.bounds.bottom) / 2
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
}

/**
 * The dump is flat (no parent/child links), so a "blind area" is approximated:
 * a large nameless clickable node with almost nothing named inside it.
 */
export function hasBlindArea(nodes: readonly ScreenTreeNode[]) {
  const named = nodes.filter(isNamedNode)
  const screenArea = nodes.reduce((max, node) => {
    if (!node.bounds) {
      return max
    }
    return Math.max(max, node.bounds.right * node.bounds.bottom)
  }, 0)
  if (screenArea <= 0) {
    return false
  }
  return nodes.some((node) => {
    if (!node.clickable || isNamedNode(node) || !node.bounds) {
      return false
    }
    if (area(node.bounds) / screenArea < TREE_BLIND_AREA_RATIO) {
      return false
    }
    const inside = named.filter((candidate) => centerInside(candidate, node.bounds!)).length
    return inside < TREE_NAMED_INSIDE_MIN
  })
}

export function assessTreeQuality(tree?: DeviceScreenTree): TreeQualityCheck {
  const nodes = tree?.nodes ?? []
  if (nodes.length === 0) {
    return { quality: 'unusable', reason: 'empty_tree' }
  }
  const named = nodes.filter(isNamedNode)
  // A resource id is a developer-facing identifier, not something the user can
  // recognise, so it does not count as a name here even though it is shown.
  const controls = nodes.filter((node) => node.clickable || node.focusable)
  const namedControls = controls.filter(isNamedNode).length
  if (
    controls.length >= 4 &&
    namedControls * TREE_UNLABELED_SHARE <= controls.length
  ) {
    return {
      quality: named.length === 0 ? 'unusable' : 'partial',
      reason: 'unlabeled_controls',
    }
  }
  if (named.length === 0) {
    return { quality: 'unusable', reason: 'no_text' }
  }
  if (named.length < TREE_ENOUGH_NAMED || hasBlindArea(nodes)) {
    return { quality: 'partial', reason: hasBlindArea(nodes) ? 'blind_area' : undefined }
  }
  return { quality: 'adequate' }
}

export function promptNodeLimit(check: TreeQualityCheck) {
  return TREE_PROMPT_NODE_LIMITS[check.quality]
}

/** One prompt line telling the model how far it may trust the tree, or null when it may. */
export function treeQualityPromptNote(check: TreeQualityCheck): string | null {
  if (check.quality === 'adequate') {
    return null
  }
  const cause =
    check.reason === 'blind_area'
      ? 'part of the screen has no readable nodes (a canvas, an image, or a page the dump cannot see)'
      : check.reason === 'unlabeled_controls'
        ? 'many controls carry no text'
        : check.reason === 'no_text'
          ? 'the tree contains no text at all'
          : 'the tree is empty'
  return [
    `Screen tree quality: ${check.quality} (${cause}).`,
    'The tree is incomplete: read the screenshot and take coordinates from it,',
    'and do not conclude that something is absent just because it is missing from the tree.',
  ].join(' ')
}
