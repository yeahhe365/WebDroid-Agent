import type { AgentAction } from './actionTypes'

/**
 * Action kinds that make the recorded device argv carry a resolved secret.
 *
 * `type_secret` is the only such action today: `toolRegistry` resolves the
 * descriptor into a real `input_text` command, so the argv sent to the device
 * *is* the secret. The record is exhaustive over the action union, so a new
 * variant is a compile error here rather than a silent gap.
 */
const SECRET_BEARING_ACTIONS: Record<AgentAction['action'], boolean> = {
  type_secret: true,
  tap: false,
  tap_ref: false,
  swipe: false,
  launch: false,
  input_text: false,
  open_url: false,
  set_clipboard: false,
  paste: false,
  key: false,
  back: false,
  home: false,
  long_press: false,
  double_tap: false,
  wait: false,
  take_over: false,
  note: false,
  interact: false,
  call_api: false,
  custom_tool: false,
  view_screenshot: false,
  sequence: false,
  repeat: false,
  done: false,
}

/**
 * True when executing this action makes the recorded device argv *be* a secret.
 *
 * Detected by action shape, never by pattern-matching argv strings: a secret can
 * look like anything. `sequence` / `repeat` recurse, because a nested secret
 * action makes the outer command sequence secret-bearing too.
 *
 * This lives in a neutral module so both sides can share one predicate without
 * inverting the layering: the trajectory projection uses it to drop the argv
 * from an artifact, and the thread store uses it to drop the argv from persisted
 * and re-loaded threads (including threads written by versions that recorded it).
 */
export function actionRecordsSecretValue(action: AgentAction): boolean {
  if (action.action === 'sequence') {
    return action.actions.some((child) => actionRecordsSecretValue(child))
  }
  if (action.action === 'repeat') {
    return actionRecordsSecretValue(action.actionToRepeat)
  }
  return SECRET_BEARING_ACTIONS[action.action]
}

/**
 * True when a recorded action pair is secret-bearing. Both the planned action
 * and the executed one are checked: coordinate mapping rewrites
 * `executionAction`, so either side can be the action that carries the secret.
 */
export function actionPairRecordsSecretValue(
  action: AgentAction,
  executionAction: AgentAction,
): boolean {
  return actionRecordsSecretValue(action) || actionRecordsSecretValue(executionAction)
}
