import { describe, expect, it } from 'vitest'
import {
  serializeFixture,
  trajectoryToActionFixtures,
  trajectoryToCoordinateFixtures,
} from './trajectoryFixture'
import type { TrajectoryArtifact } from './trajectory'

function artifact(
  step: Partial<TrajectoryArtifact['steps'][number]> = {},
  device: Partial<TrajectoryArtifact['device']> = {},
): TrajectoryArtifact {
  return {
    schemaVersion: 1,
    kind: 'webdroid.trajectory',
    exportedAt: '2026-09-13T00:00:00.000Z',
    app: { version: '0.2.0' },
    run: { runId: 'run_a', threadId: 't1', task: 'tap', status: 'done', startedAt: 1, partial: false, stepTurnIds: ['turn_1'] },
    model: { model: 'gpt-4o', actionProtocol: 'webdroid_json', coordinateMode: 'screenshot_pixels' },
    device: { name: 'android-device', screen: { width: 1080, height: 2316 }, modelScreen: { width: 720, height: 1544 }, ...device },
    steps: [
      {
        index: 1,
        turnId: 'turn_1',
        timing: { captureMs: 0, currentAppMs: 0, modelMs: 0, parseMs: 0, totalMs: 0 },
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        context: { chars: 3, digest: 'fnv1a32:00000000' },
        modelOutput: '{"action":"tap","x":100,"y":200}',
        action: { action: 'tap', x: 100, y: 200 },
        executionAction: { action: 'tap', x: 150, y: 300 },
        executionResult: 'ok',
        success: true,
        ...step,
      },
    ],
    outcome: {},
  }
}

describe('trajectoryToActionFixtures', () => {
  it('derives a parse fixture from the recorded model output', () => {
    const [fixture] = trajectoryToActionFixtures(artifact())
    expect(fixture?.input.modelOutput).toBe('{"action":"tap","x":100,"y":200}')
    expect(fixture?.expected).toEqual({ action: { action: 'tap', x: 100, y: 200 } })
    expect(fixture?.source).toBe('trajectory:run_a#1')
    expect(fixture?.schemaVersion).toBe(1)
  })

  it('skips steps whose model output is empty, which nothing can be replayed from', () => {
    expect(trajectoryToActionFixtures(artifact({ modelOutput: '   ' }))).toEqual([])
  })

  it('falls back to the native screen when the model screen is unknown', () => {
    const [fixture] = trajectoryToActionFixtures(artifact({}, { modelScreen: undefined }))
    expect(fixture?.input.screen).toEqual({ width: 1080, height: 2316 })
  })
})

describe('trajectoryToCoordinateFixtures', () => {
  it('pairs the model-space action with the native-space execution action', () => {
    const [fixture] = trajectoryToCoordinateFixtures(artifact())
    expect(fixture?.input.fromScreen).toEqual({ width: 720, height: 1544 })
    expect(fixture?.input.toScreen).toEqual({ width: 1080, height: 2316 })
    expect(fixture?.expected.action).toEqual({ action: 'tap', x: 150, y: 300 })
  })

  it('skips steps without a model screen, which cannot be replayed', () => {
    const bare = artifact()
    delete bare.device.modelScreen
    expect(trajectoryToCoordinateFixtures(bare)).toEqual([])
  })

  it('skips steps whose recorded action carries no coordinates', () => {
    const bare = artifact({
      action: { action: 'done', summary: 'finished' },
      executionAction: { action: 'done', summary: 'finished' },
    })
    expect(trajectoryToCoordinateFixtures(bare)).toEqual([])
  })
})

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const a = JSON.stringify(trajectoryToActionFixtures(artifact()))
    const b = JSON.stringify(trajectoryToActionFixtures(artifact()))
    expect(a).toBe(b)
  })
})

describe('serializeFixture', () => {
  it('writes two-space JSON with a trailing newline, which the generator script must match', () => {
    const [fixture] = trajectoryToActionFixtures(artifact())
    const text = serializeFixture(fixture!)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "kind": "webdroid.action-fixture"')
    expect(JSON.parse(text)).toEqual(fixture)
  })
})
