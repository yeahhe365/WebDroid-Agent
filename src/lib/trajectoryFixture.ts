import type { ActionCoordinateMode, ActionProtocol } from './actionProtocol'
import type { AgentAction, ScreenSize } from './actionTypes'
import type { TrajectoryArtifact } from './trajectory'

/**
 * Fixture schema for the offline replay suite (Layer 1).
 *
 * This module is the authoritative definition of a fixture's shape.
 * `scripts/trajectory-to-fixture.mjs` mirrors the same field names in plain
 * JavaScript on purpose: the generator has to run under bare `node` with no
 * build step, so it cannot import this TypeScript module (and the project takes
 * no new dependencies, which rules out a TS loader).
 */
export const FIXTURE_SCHEMA_VERSION = 1

export type ActionFixture = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  kind: 'webdroid.action-fixture'
  name: string
  source: string
  input: {
    modelOutput: string
    screen: ScreenSize
    actionProtocol: ActionProtocol
    coordinateMode: ActionCoordinateMode
  }
  expected: { action: AgentAction } | { error: { messageIncludes: string } }
  note?: string
}

export type CoordinateFixture = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  kind: 'webdroid.coordinate-fixture'
  name: string
  source: string
  input: { action: AgentAction; fromScreen: ScreenSize; toScreen: ScreenSize }
  expected: { action: AgentAction }
  note?: string
}

export function trajectoryToActionFixtures(artifact: TrajectoryArtifact): ActionFixture[] {
  const coordinateMode = artifact.model.coordinateMode
  return artifact.steps
    .filter((step) => step.modelOutput.trim() !== '')
    .map((step) => ({
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      kind: 'webdroid.action-fixture',
      name: `${artifact.run.runId}-step-${step.index}`,
      source: `trajectory:${artifact.run.runId}#${step.index}`,
      input: {
        modelOutput: step.modelOutput,
        screen: artifact.device.modelScreen ?? artifact.device.screen,
        actionProtocol: artifact.model.actionProtocol,
        coordinateMode,
      },
      expected: { action: step.action },
      note: 'expected values are the recorded action; confirm before committing',
    }))
}

export function trajectoryToCoordinateFixtures(artifact: TrajectoryArtifact): CoordinateFixture[] {
  const fromScreen = artifact.device.modelScreen
  if (!fromScreen) {
    return []
  }
  return artifact.steps
    .filter((step) => hasCoordinates(step.action))
    .map((step) => ({
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      kind: 'webdroid.coordinate-fixture',
      name: `${artifact.run.runId}-step-${step.index}`,
      source: `trajectory:${artifact.run.runId}#${step.index}`,
      input: { action: step.action, fromScreen, toScreen: artifact.device.screen },
      expected: { action: step.executionAction },
      note: 'expected values are the recorded execution action; confirm before committing',
    }))
}

/**
 * The action shapes `mapActionCoordinates` can map, and therefore the only ones
 * a coordinate fixture can replay: a single point (`x`/`y`, as in `tap`,
 * `long_press` and `double_tap`) or a swipe (`fromX`/`fromY`/`toX`/`toY`).
 * Anything else has no coordinate to translate.
 */
function hasCoordinates(action: AgentAction) {
  if ('x' in action && 'y' in action) {
    return true
  }
  return 'fromX' in action && 'fromY' in action && 'toX' in action && 'toY' in action
}

export function serializeFixture(fixture: ActionFixture | CoordinateFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}
