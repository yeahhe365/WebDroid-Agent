import type { DeviceScreenTree, ScreenTreeNode } from '../adapters/uiAutomator'
import { isEditableNode, isNamedNode } from './treeQuality'

/**
 * Why a screen cannot be worked with, decided from facts rather than from the
 * model's own wording.
 *
 * The takeover kinds used to be inferred from the message the model wrote, so a
 * model that said "I need you to log in" created a login card and a model that
 * said nothing did not. The screen itself is the evidence: a password field, a
 * captcha phrase, a payment confirmation, an empty tree, or a picture that is
 * completely black while the tree is readable (the app blocks capture).
 */
export type ScreenState =
  | 'normal'
  | 'blank'
  | 'loading'
  | 'protected'
  | 'capture_unavailable'
  | 'needs_human'

export type ScreenTakeoverKind = 'login' | 'captcha' | 'payment'

export type ScreenFacts = {
  nodeCount: number
  namedCount: number
  passwordField?: boolean
  texts?: readonly string[]
  /** Consecutive steps whose tree was byte-identical. */
  unchangedRuns?: number
  /** Consecutive screenshots that showed nothing at all. */
  blackFrames?: number
}

export type ScreenCheck = {
  state: ScreenState
  needsHuman: boolean
  takeoverKind?: ScreenTakeoverKind
  cause?: string
}

export const CAPTCHA_WORDS = [
  'captcha',
  '人机验证',
  '安全验证',
  '滑块验证',
  '拖动滑块',
  '向右滑动完成',
  '请完成验证',
  'verify you are human',
  'not a robot',
] as const

export const PAYMENT_WORDS = [
  '支付密码',
  '确认支付',
  '确认付款',
  '立即支付',
  '输入密码支付',
  'payment password',
  'confirm payment',
  'pay now',
] as const

export const LOGIN_WORDS = [
  '登录',
  '登入',
  '账号密码',
  '输入密码',
  '密码',
  'sign in',
  'log in',
  'login',
  'enter your password',
  'password',
] as const

/** Screenshots this many deep that still show nothing mean capture is blocked, not lag. */
export const CAPTURE_FAILED_FRAMES = 2
/** A tree identical this many steps in a row is not animating any more. */
export const STABLE_SCREEN_RUNS = 2

export function isPasswordFieldNode(node: ScreenTreeNode) {
  if (node.password) {
    return true
  }
  // The dump reports `password="true"`; older dumps and some WebViews do not,
  // so a password-ish id on an editable node is the fallback signal.
  return (
    isEditableNode(node) &&
    /password|passwd|pwd/i.test(`${node.className ?? ''} ${node.resourceId ?? ''}`)
  )
}

export function hasPasswordField(tree?: DeviceScreenTree) {
  return Boolean(tree?.nodes.some(isPasswordFieldNode))
}

/** Every string the user could read on this screen, deduplicated in tree order. */
export function screenTexts(tree?: DeviceScreenTree): string[] {
  const texts: string[] = []
  for (const node of tree?.nodes ?? []) {
    for (const value of [node.text, node.contentDescription]) {
      const trimmed = value?.trim()
      if (trimmed && !texts.includes(trimmed)) {
        texts.push(trimmed)
      }
    }
  }
  return texts
}

/** Cheap structural fingerprint: bounds, text and state, in tree order. */
export function treeSignature(tree?: DeviceScreenTree): string {
  if (!tree) {
    return ''
  }
  return tree.nodes
    .map((node) =>
      [
        node.className ?? '',
        node.resourceId ?? '',
        node.text ?? '',
        node.contentDescription ?? '',
        node.bounds
          ? `${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom}`
          : '',
        node.selected ? 's' : '',
        node.focused ? 'f' : '',
      ].join('~'),
    )
    .join('|')
}

function hit(texts: readonly string[], words: readonly string[]) {
  const haystack = texts.join('\n').toLowerCase()
  return words.find((word) => haystack.includes(word)) ?? null
}

export function classifyScreen(facts: ScreenFacts): ScreenCheck {
  const texts = facts.texts ?? []
  const blackFrames = facts.blackFrames ?? 0
  const unchangedRuns = facts.unchangedRuns ?? 0

  if (facts.passwordField || hit(texts, PAYMENT_WORDS) || hit(texts, CAPTCHA_WORDS)) {
    const kind: ScreenTakeoverKind = hit(texts, CAPTCHA_WORDS)
      ? 'captcha'
      : hit(texts, PAYMENT_WORDS)
        ? 'payment'
        : 'login'
    return {
      state: 'needs_human',
      needsHuman: true,
      takeoverKind: kind,
      cause: facts.passwordField ? 'password_field' : `${kind}_text`,
    }
  }
  if (hit(texts, LOGIN_WORDS)) {
    return {
      state: 'needs_human',
      needsHuman: true,
      takeoverKind: 'login',
      cause: 'login_text',
    }
  }

  // A black picture with a readable tree is how a capture-blocked app looks
  // (FLAG_SECURE): the app is there, its pixels are not.
  if (blackFrames >= CAPTURE_FAILED_FRAMES) {
    return facts.namedCount > 0
      ? { state: 'protected', needsHuman: false, cause: 'blank_capture_with_tree' }
      : { state: 'capture_unavailable', needsHuman: false, cause: 'blank_capture_without_tree' }
  }

  if (facts.namedCount === 0 || facts.nodeCount === 0) {
    if (unchangedRuns >= STABLE_SCREEN_RUNS) {
      return { state: 'blank', needsHuman: false, cause: 'empty_stable_screen' }
    }
    return { state: 'loading', needsHuman: false, cause: 'no_readable_nodes_yet' }
  }

  return { state: 'normal', needsHuman: false }
}

export type ScreenFactsInput = {
  tree?: DeviceScreenTree
  /** Whether the latest screenshot decoded to (almost) nothing. */
  screenshotBlank?: boolean
  /** How many consecutive steps in a row produced the same tree signature. */
  unchangedRuns?: number
  /** How many consecutive screenshots in a row were blank. */
  blackFrames?: number
}

export function screenFactsFrom({
  tree,
  screenshotBlank,
  unchangedRuns,
  blackFrames,
}: ScreenFactsInput): ScreenFacts {
  const nodes = tree?.nodes ?? []
  return {
    nodeCount: nodes.length,
    namedCount: nodes.filter(isNamedNode).length,
    passwordField: hasPasswordField(tree),
    texts: screenTexts(tree),
    unchangedRuns: unchangedRuns ?? 0,
    blackFrames: blackFrames ?? (screenshotBlank ? CAPTURE_FAILED_FRAMES : 0),
  }
}

const STATE_GUIDANCE: Record<ScreenState, string> = {
  normal: '',
  blank:
    'The screen is empty and not changing. The app may still be starting: wait once, then go back or relaunch.',
  loading:
    'Nothing readable is on screen yet. The app is probably still loading: check the screenshot before acting.',
  protected:
    'The app blocks screen capture but its tree is readable. Act from the tree; do not describe what the picture shows.',
  capture_unavailable:
    'The screen picture is blank and nothing is readable. Stop guessing: use take_over with kind "other" and explain that the device screen cannot be read (a locked screen, a secure page, or the virtual display is not composed).',
  needs_human:
    'This screen needs the user: login, captcha or payment. Use take_over with the matching kind instead of trying to get through it.',
}

/** Prompt block for the current screen state; empty for a normal screen. */
export function formatScreenStateForPrompt(check: ScreenCheck): string {
  if (check.state === 'normal') {
    return ''
  }
  return [
    `<screen_state state="${check.state}"${check.cause ? ` cause="${check.cause}"` : ''}>`,
    STATE_GUIDANCE[check.state],
    '</screen_state>',
  ].join('\n')
}
