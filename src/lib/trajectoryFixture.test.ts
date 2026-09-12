/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  serializeFixture,
  trajectoryToActionFixtures,
  trajectoryToCoordinateFixtures,
} from './trajectoryFixture'
import type { ActionFixture, CoordinateFixture } from './trajectoryFixture'
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

  it('projects a swipe as a coordinate fixture carrying all four touch points', () => {
    const [fixture] = trajectoryToCoordinateFixtures(
      artifact({
        modelOutput: '{"action":"swipe","fromX":10,"fromY":20,"toX":30,"toY":40}',
        action: { action: 'swipe', fromX: 10, fromY: 20, toX: 30, toY: 40 },
        executionAction: { action: 'swipe', fromX: 15, fromY: 30, toX: 45, toY: 60 },
      }),
    )
    expect(fixture?.input.action).toEqual({ action: 'swipe', fromX: 10, fromY: 20, toX: 30, toY: 40 })
    expect(fixture?.expected.action).toEqual({ action: 'swipe', fromX: 15, fromY: 30, toX: 45, toY: 60 })
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

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/trajectory-to-fixture.mjs', import.meta.url))

/** Scratch directory outside the repository; every caller removes it in a `finally`. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'trajectory-fixture-'))
}

function writeArtifact(dir: string, source: TrajectoryArtifact): string {
  const artifactPath = join(dir, 'trajectory.json')
  writeFileSync(artifactPath, JSON.stringify(source))
  return artifactPath
}

function runGenerator(dir: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: dir, encoding: 'utf8' })
}

function expectDirectoryMatches(
  outDir: string,
  kind: 'actions' | 'coordinates',
  fixtures: Array<ActionFixture | CoordinateFixture>,
): void {
  expect(readdirSync(join(outDir, kind)).sort()).toEqual(
    fixtures.map((fixture) => `${fixture.name}.json`).sort(),
  )
  for (const fixture of fixtures) {
    expect(readFileSync(join(outDir, kind, `${fixture.name}.json`), 'utf8')).toBe(
      serializeFixture(fixture),
    )
  }
}

/**
 * The script re-implements the projection on purpose (bare `node`, no build
 * step, no `src/` import), so the only thing that keeps the twins honest is
 * running the real script and comparing its bytes with `serializeFixture`.
 * Both cases matter: a tap covers the `x`/`y` predicate, a swipe the
 * `fromX`/`fromY`/`toX`/`toY` one.
 */
describe('generator script projection agreement', () => {
  const cases: Array<[string, TrajectoryArtifact]> = [
    ['tap', artifact()],
    [
      'swipe',
      artifact({
        modelOutput: '{"action":"swipe","fromX":10,"fromY":20,"toX":30,"toY":40}',
        action: { action: 'swipe', fromX: 10, fromY: 20, toX: 30, toY: 40 },
        executionAction: { action: 'swipe', fromX: 15, fromY: 30, toX: 45, toY: 60 },
      }),
    ],
  ]

  for (const [label, source] of cases) {
    it(`writes exactly the TypeScript projection, file names included (${label})`, () => {
      const dir = tempDir()
      try {
        const artifactPath = writeArtifact(dir, source)
        const outDir = join(dir, 'out')
        const result = runGenerator(dir, [artifactPath, '--out', outDir])
        expect(result.status, `generator stderr: ${result.stderr}`).toBe(0)

        expectDirectoryMatches(outDir, 'actions', trajectoryToActionFixtures(source))
        expectDirectoryMatches(outDir, 'coordinates', trajectoryToCoordinateFixtures(source))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})

describe('generator script argument and input guards', () => {
  it('refuses an empty or whitespace --out instead of writing into the working directory', () => {
    for (const value of ['', '   ']) {
      const dir = tempDir()
      try {
        const artifactPath = writeArtifact(dir, artifact())
        const result = runGenerator(dir, [artifactPath, '--out', value])
        expect(result.status, `--out ${JSON.stringify(value)}: ${result.stderr}`).not.toBe(0)
        expect(result.stderr).toContain('Refusing to generate fixtures')
        expect(readdirSync(dir)).toEqual(['trajectory.json'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('refuses inline image data whatever the case of the URI scheme', () => {
    const dir = tempDir()
    try {
      const artifactPath = writeArtifact(dir, artifact({ modelOutput: 'DATA:image/png;base64,AAAA' }))
      const outDir = join(dir, 'out')
      const result = runGenerator(dir, [artifactPath, '--out', outDir])
      expect(result.status, result.stderr).not.toBe(0)
      expect(result.stderr).toContain('inline image data')
      expect(existsSync(outDir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
