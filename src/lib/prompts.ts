import type { ActionProtocol } from './actionProtocol'
import {
  protocolCoordinateInstructionForActionProtocol,
  touchCoordinateInstructionForActionProtocol,
} from './coordinateSystems'

export const PHONE_OPERATION_RULES = [
  [
    'Before acting, check whether the current app is already the target app;',
    'launch the target app only when needed.',
  ].join(' '),
  [
    'If the current page is unrelated, go back.',
    'If Back has no effect, use visible close or top-left back controls.',
  ].join(' '),
  'If content is still loading, wait. Do not wait more than three consecutive times before trying recovery.',
  [
    'If a tap does not change the state, wait briefly, retry with an adjusted nearby point,',
    'then move on and explain in the final message if it still fails.',
  ].join(' '),
  [
    'If the previous action failed, read the failure feedback and current screenshot,',
    'then choose a different recovery action instead of repeating the exact same parameters.',
  ].join(' '),
  [
    'If scrolling does not work, adjust the start point and increase distance.',
    'If still stuck, try the opposite direction before concluding the item is not found.',
  ].join(' '),
  [
    'When multiple tabs or categories could contain the target,',
    'inspect each one once instead of looping in the same category.',
  ].join(' '),
  [
    'For sensitive operations involving payment, orders, privacy, deletion,',
    'permissions, passwords, or account changes, include a message field on the tap',
    'so the user can confirm.',
  ].join(' '),
  [
    'For login, captcha, verification code, and password entry, use take_over with',
    'kind "login" or "captcha"; for payment or checkout, use kind "payment";',
    'otherwise use kind "other". Use type_secret instead of take_over when a',
    'matching available secret id is listed and the user asked to use it.',
  ].join(' '),
  [
    'Before done, verify the task is fully and accurately completed.',
    'Correct wrong, missing, or extra selections before finishing.',
  ].join(' '),
]

const MEMORY_ENABLED_PHONE_OPERATION_RULES = [
  [
    'When temporarily opening SMS, Messages, Mail, Browser, or an authenticator app',
    'to retrieve a verification code, preserve the original task, record the code',
    'with note, return to the previous task app, and continue there.',
  ].join(' '),
  [
    'Use note to store short durable facts needed later, such as',
    'verification codes, selected accounts, original app names, or return instructions.',
  ].join(' '),
]

const MEMORY_DISABLED_PHONE_OPERATION_RULES = [
  [
    'Memory is disabled.',
    'Do not use note for durable facts, and do not assume observations will be saved for later tasks.',
  ].join(' '),
  [
    'When temporarily opening SMS, Messages, Mail, Browser, or an authenticator app',
    'to retrieve a verification code, preserve the original task, return to the previous task app,',
    'and continue there without storing a durable memory.',
  ].join(' '),
]

const UNRESTRICTED_SENSITIVE_OPERATION_RULE = [
    'For sensitive operations involving payment, orders, privacy, deletion, permissions,',
    'passwords, login, captcha, verification codes, or account changes,',
    'continue autonomously using the available executable actions.',
].join(' ')

export function buildSystemPrompt({
  actionProtocol = 'webdroid_json',
  unrestrictedMode = false,
  memoryEnabled = false,
}: {
  actionProtocol?: ActionProtocol
  unrestrictedMode?: boolean
  memoryEnabled?: boolean
} = {}) {
  const operationRules = buildPhoneOperationRules(memoryEnabled)
  const behaviorRules = unrestrictedMode
    ? [
        [
          'Unrestricted mode is enabled.',
          'Do not request human takeover, do not return take_over, and do not ask for confirmation.',
          'Choose the next executable action yourself until the task is complete.',
        ].join(' '),
        [
          'For sensitive operations involving payment, orders, privacy, deletion,',
          'permissions, passwords, login, captcha, verification codes, or account changes,',
          'continue autonomously using the available actions.',
        ].join(' '),
        ...operationRules.slice(0, -3),
        UNRESTRICTED_SENSITIVE_OPERATION_RULE,
        operationRules.at(-1) ?? '',
      ]
    : [
        'Do not interact with payments, passwords, or destructive actions without explicit confirmation metadata.',
        ...operationRules,
      ]

  const protocolInstructions = buildProtocolInstructions(actionProtocol)

  return [
    'You are a phone-control agent for an Android device.',
    'Inspect the screenshot and choose exactly one next action.',
    'A sequence or repeat action still counts as one next action object.',
    ...protocolInstructions,
    [
      'Use input_text with clear:true when replacing text in a search, address,',
      'or already-filled field; omit clear or set clear:false only when appending.',
    ].join(' '),
    'Use wait with duration in seconds, defaulting to 1.0, for animations, page loads, or time-based operations.',
    touchCoordinateInstructionForActionProtocol(actionProtocol),
    'Do not invent shell commands.',
    'If <available_action_tools> is present in context, treat it as the executable tool contract and use only listed action names.',
    ...behaviorRules,
  ].join('\n')
}

function buildPhoneOperationRules(memoryEnabled: boolean) {
  const beforeSensitiveRules = PHONE_OPERATION_RULES.slice(0, 7)
  const sensitiveAndFinalRules = PHONE_OPERATION_RULES.slice(7)
  return [
    ...beforeSensitiveRules,
    ...(memoryEnabled
      ? MEMORY_ENABLED_PHONE_OPERATION_RULES
      : MEMORY_DISABLED_PHONE_OPERATION_RULES),
    ...sensitiveAndFinalRules,
  ]
}

function buildProtocolInstructions(actionProtocol: ActionProtocol) {
  return [
    'Return only one JSON object. No markdown, no prose.',
    protocolCoordinateInstructionForActionProtocol(actionProtocol),
    'Supported canonical JSON actions:',
    '{"action":"launch","app":"Settings|Chrome|YouTube|京东|package.name","reason":"short reason"}',
    [
      '{"action":"tap","x":number,"y":number,"reason":"short reason",',
      '"message":"required for sensitive taps","risk":"sensitive"}',
    ].join(''),
    [
      '{"action":"swipe","fromX":number,"fromY":number,"toX":number,"toY":number,',
      '"durationMs":number,"reason":"short reason"}',
    ].join(''),
    '{"action":"input_text","text":"Unicode text to type","clear":boolean,"reason":"short reason"}',
    '{"action":"type_secret","secretId":"local-secret-id","clear":boolean,"reason":"short reason"}',
    '{"action":"open_url","url":"https://example.com or app://deep-link","reason":"short reason"}',
    '{"action":"set_clipboard","text":"Text to paste later","reason":"short reason"}',
    '{"action":"paste","reason":"short reason"}',
    '{"action":"custom_tool","tool":"tool_name","input":{"key":"value"},"reason":"short reason"}',
    '{"action":"view_screenshot","ref":"step-3","step":number,"reason":"short reason"}',
    '{"action":"key","key":"BACK|HOME|ENTER|POWER|APP_SWITCH|MENU","reason":"short reason"}',
    '{"action":"back","reason":"short reason"}',
    '{"action":"home","reason":"short reason"}',
    '{"action":"long_press","x":number,"y":number,"durationMs":number,"reason":"short reason"}',
    '{"action":"double_tap","x":number,"y":number,"reason":"short reason"}',
    '{"action":"wait","duration":number,"reason":"short reason"}',
    '{"action":"sequence","actions":[{"action":"tap","x":number,"y":number},{"action":"input_text","text":"value"}],"reason":"short reason"}',
    '{"action":"repeat","count":number,"actionToRepeat":{"action":"swipe","fromX":number,"fromY":number,"toX":number,"toY":number},"delayMs":number,"reason":"short reason"}',
    '{"action":"take_over","kind":"login|captcha|payment|other","message":"what the human must do"}',
    '{"action":"note","message":"short observation"}',
    '{"action":"done","summary":"what was completed"}',
    'Use sequence or repeat only for short, visible, stable action chains. sequence is capped at 8 child actions and repeat count at 10. Child actions cannot be done, take_over, sequence, or repeat.',
  ]
}
