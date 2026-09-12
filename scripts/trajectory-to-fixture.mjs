#!/usr/bin/env node
/**
 * Derive replay fixtures from a recorded trajectory artifact.
 *
 *   node scripts/trajectory-to-fixture.mjs <trajectory.json> [--out <dir>] [--force]
 *   npm run trajectory:fixture -- <trajectory.json>
 *
 * Why this file re-implements the projection that already exists in
 * `src/lib/trajectoryFixture.ts`: fixtures must be regenerable with bare Node,
 * and this milestone adds no dependencies (so no TypeScript loader) and no build
 * step for scripts. `src/lib/trajectoryFixture.ts` stays authoritative for the
 * shape — this script must emit the same field names in the same order and the
 * same two-space JSON with a trailing newline.
 *
 * Three rules keep a human in the loop, because a generator that rewrites an
 * expectation turns the replay suite into a tautology:
 *   1. the default destination is git-ignored staging, never `test/fixtures/`;
 *   2. an existing file is never replaced without `--force`, and the diff of its
 *      `expected` block is printed so the human re-confirms the expectation;
 *   3. anything unsafe (inline image data, a missing projected field, a name
 *      that is not a plain file name, a non-deterministic projection) refuses
 *      the whole run before a single byte is written, with a non-zero exit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA_VERSION = 1
const ACTION_KIND = 'webdroid.action-fixture'
const COORDINATE_KIND = 'webdroid.coordinate-fixture'
const STAGING_RELATIVE = '.superpowers/sdd/2026-09-13-trajectory-failure-taxonomy/fixtures-staging'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** A fixture name becomes a file name, so it may not traverse or start with a dot. */
const SAFE_FIXTURE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const USAGE = `Usage: node scripts/trajectory-to-fixture.mjs <trajectory.json> [--out <dir>] [--force]

  --out <dir>  destination root (default: ${STAGING_RELATIVE}/, git-ignored scratch)
  --force      replace existing fixture files; without it they are left alone and
               the diff of their "expected" block is printed for re-confirmation

Counts reported on every run: written (new, plus --force replacements),
skipped (existing files left alone) and refused (unsafe input; nothing written).`

main()

function main() {
  const options = parseArgs(process.argv.slice(2))
  const inputPath = resolve(options.input)
  const outRoot = options.out === undefined ? join(REPO_ROOT, STAGING_RELATIVE) : resolve(options.out)

  const artifact = readArtifact(inputPath)
  const projected = project(artifact)

  // Smoke check for accidental non-determinism (a clock, a random id, or a
  // mutation of the artifact between two projections) before anything is written.
  if (JSON.stringify(project(artifact)) !== JSON.stringify(projected)) {
    refuse('the projection is not deterministic; fixtures must be reproducible')
  }

  validateFixtureNames(projected.actionFixtures)
  validateFixtureNames(projected.coordinateFixtures)

  console.log(`Trajectory: ${relative(process.cwd(), inputPath) || inputPath}`)
  console.log(
    `Run: ${artifact.run.runId} (${artifact.steps.length} step(s)); destination: ${relative(process.cwd(), outRoot) || outRoot}`,
  )

  const reports = [
    writeAll(join(outRoot, 'actions'), projected.actionFixtures, options),
    writeAll(join(outRoot, 'coordinates'), projected.coordinateFixtures, options),
  ]
  summarize(reports)
}

function parseArgs(argv) {
  const options = { input: undefined, out: undefined, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      options.force = true
    } else if (arg === '--out') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        failUsage('--out needs a directory')
      }
      options.out = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else if (arg.startsWith('-')) {
      failUsage(`unknown option ${arg}`)
    } else if (options.input === undefined) {
      options.input = arg
    } else {
      failUsage(`unexpected extra argument ${arg}`)
    }
  }
  if (options.input === undefined) {
    failUsage('missing trajectory file')
  }
  return options
}

function readArtifact(inputPath) {
  let raw
  try {
    raw = readFileSync(inputPath, 'utf8')
  } catch {
    refuse(`cannot read ${inputPath}`)
  }

  let artifact
  try {
    artifact = JSON.parse(raw)
  } catch (error) {
    refuse(`${inputPath} is not valid JSON (${error.message})`)
  }

  const problem = validateArtifact(artifact)
  if (problem !== undefined) {
    refuse(problem)
  }
  // Parsing first normalises \uXXXX escapes, so this still catches an inline
  // image whose prefix was hidden behind an escape in the raw text.
  if (JSON.stringify(artifact).includes('data:image')) {
    refuse('the trajectory contains inline image data; fixtures must never carry pixels')
  }
  return artifact
}

/**
 * Every field the projection below reads must exist: a missing one would write a
 * fixture with a hole in it (an absent `input.screen`, `undefined` expectations)
 * that the replay suite cannot catch.
 */
function validateArtifact(artifact) {
  if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) {
    return 'the artifact must be a JSON object'
  }
  if (artifact.kind !== 'webdroid.trajectory' || artifact.schemaVersion !== SCHEMA_VERSION) {
    return `unsupported artifact: kind=${artifact.kind} schemaVersion=${artifact.schemaVersion}`
  }
  if (typeof artifact.run?.runId !== 'string' || artifact.run.runId === '') {
    return 'artifact.run.runId is missing, and fixture names derive from it'
  }
  if (typeof artifact.model?.actionProtocol !== 'string') {
    return 'artifact.model.actionProtocol is missing'
  }
  if (typeof artifact.model.coordinateMode !== 'string') {
    return 'artifact.model.coordinateMode is missing'
  }
  if (!isScreen(artifact.device?.screen)) {
    return 'artifact.device.screen is missing'
  }
  if (artifact.device.modelScreen !== undefined && !isScreen(artifact.device.modelScreen)) {
    return 'artifact.device.modelScreen is not a screen size'
  }
  if (!Array.isArray(artifact.steps)) {
    return 'artifact.steps must be an array'
  }
  for (const [position, step] of artifact.steps.entries()) {
    const where = `artifact.steps[${position}]`
    if (typeof step?.index !== 'number') {
      return `${where}.index is missing`
    }
    if (typeof step.modelOutput !== 'string') {
      return `${where}.modelOutput is missing`
    }
    if (!isAction(step.action)) {
      return `${where}.action is missing`
    }
    if (!isAction(step.executionAction)) {
      return `${where}.executionAction is missing`
    }
  }
  return undefined
}

function isScreen(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  )
}

function isAction(value) {
  return typeof value === 'object' && value !== null && typeof value.action === 'string'
}

/**
 * A fixture name becomes a file name, so it must not escape the destination
 * directory; and two fixtures that resolve to the same file would silently make
 * one of them win, which is exactly the ambiguity a locked expectation cannot
 * tolerate. Actions and coordinates are checked separately: they live in
 * different directories and legitimately share names.
 */
function validateFixtureNames(fixtures) {
  const seen = new Set()
  for (const fixture of fixtures) {
    if (!SAFE_FIXTURE_NAME.test(fixture.name)) {
      refuse(`fixture name ${JSON.stringify(fixture.name)} is not a safe file name`)
    }
    if (seen.has(fixture.name)) {
      refuse(`two ${fixture.kind} fixtures project to the same name ${JSON.stringify(fixture.name)}`)
    }
    seen.add(fixture.name)
  }
}

/**
 * The same field rules as `trajectoryToActionFixtures` /
 * `trajectoryToCoordinateFixtures` in `src/lib/trajectoryFixture.ts`.
 */
function project(artifact) {
  return {
    actionFixtures: artifact.steps
      .filter((step) => step.modelOutput.trim() !== '')
      .map((step) => ({
        schemaVersion: SCHEMA_VERSION,
        kind: ACTION_KIND,
        name: `${artifact.run.runId}-step-${step.index}`,
        source: `trajectory:${artifact.run.runId}#${step.index}`,
        input: {
          modelOutput: step.modelOutput,
          screen: artifact.device.modelScreen ?? artifact.device.screen,
          actionProtocol: artifact.model.actionProtocol,
          coordinateMode: artifact.model.coordinateMode,
        },
        expected: { action: step.action },
        note: 'expected values are the recorded action; confirm before committing',
      })),
    coordinateFixtures: projectCoordinateFixtures(artifact),
  }
}

function projectCoordinateFixtures(artifact) {
  const fromScreen = artifact.device.modelScreen
  if (!fromScreen) {
    // Without model-space geometry the mapping cannot be replayed at all, so a
    // fixture would be worse than none.
    return []
  }
  return artifact.steps
    .filter((step) => 'x' in step.action && 'y' in step.action)
    .map((step) => ({
      schemaVersion: SCHEMA_VERSION,
      kind: COORDINATE_KIND,
      name: `${artifact.run.runId}-step-${step.index}`,
      source: `trajectory:${artifact.run.runId}#${step.index}`,
      input: { action: step.action, fromScreen, toScreen: artifact.device.screen },
      expected: { action: step.executionAction },
      note: 'expected values are the recorded execution action; confirm before committing',
    }))
}

function serializeFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`
}

function writeAll(dir, fixtures, options) {
  const report = { written: [], unchanged: [], differing: [], replaced: [] }
  for (const fixture of fixtures) {
    const target = join(dir, `${fixture.name}.json`)
    const next = serializeFixture(fixture)

    if (!existsSync(target)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(target, next)
      report.written.push(target)
      continue
    }

    const current = readFileSync(target, 'utf8')
    if (current === next) {
      report.unchanged.push(target)
      continue
    }
    if (!options.force) {
      report.differing.push({ target, current, next })
      continue
    }
    writeFileSync(target, next)
    report.written.push(target)
    report.replaced.push(target)
  }
  return report
}

function summarize(reports) {
  for (const report of reports) {
    for (const target of report.written) {
      const replaced = report.replaced.includes(target) ? ' (replaced, --force)' : ''
      console.log(`written   ${relative(process.cwd(), target)}${replaced}`)
    }
    for (const target of report.unchanged) {
      console.log(`skipped   ${relative(process.cwd(), target)} (already identical)`)
    }
    for (const { target, current, next } of report.differing) {
      console.log(`skipped   ${relative(process.cwd(), target)} (exists; not overwritten without --force)`)
      for (const line of describeExpectedDifference(current, next)) {
        console.log(line)
      }
    }
  }

  const written = reports.reduce((total, report) => total + report.written.length, 0)
  const replaced = reports.reduce((total, report) => total + report.replaced.length, 0)
  const unchanged = reports.reduce((total, report) => total + report.unchanged.length, 0)
  const differing = reports.reduce((total, report) => total + report.differing.length, 0)
  console.log(`Summary: written ${written}, skipped ${unchanged + differing}, refused 0`)
  if (replaced > 0) {
    console.log(`  replaced ${replaced} existing fixture(s) because --force was given`)
  }
  if (differing > 0) {
    console.log(`  ${differing} existing fixture(s) differ; review the diff above before re-running with --force`)
  }
  console.log('Review the "expected" values by hand before committing anything into test/fixtures/.')
}

function describeExpectedDifference(current, next) {
  const before = readExpected(current)
  const after = readExpected(next)
  if (before === undefined) {
    return ['  the existing file is not valid JSON, so its expected block cannot be diffed']
  }
  if (!before.present || !after.present) {
    const lines = [`  expected: ${before.present ? 'present' : 'absent'} -> ${after.present ? 'present' : 'absent'}`]
    const shown = after.present ? after : before
    const sign = after.present ? '+' : '-'
    if (shown.present) {
      lines.push(...shown.text.split('\n').map((line) => `  ${sign} ${line}`))
    }
    return lines
  }
  return formatUnifiedDiff('expected (existing)', 'expected (generated)', before.text, after.text)
}

/** `undefined` means "not JSON", `{ present: false }` means JSON without `expected`. */
function readExpected(text) {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || !('expected' in parsed)) {
      return { present: false, text: '' }
    }
    return { present: true, text: JSON.stringify(parsed.expected, null, 2) }
  } catch {
    return undefined
  }
}

function formatUnifiedDiff(beforeLabel, afterLabel, beforeText, afterText, maxLines = 30) {
  const ops = diffLines(beforeText.split('\n'), afterText.split('\n'))
  const first = ops.findIndex((op) => op.sign !== ' ')
  if (first === -1) {
    // The file differs (so it is still not overwritten), but the re-serialised
    // expectation is identical: the change is outside the block a human confirms.
    return ['  the expected block is unchanged; the file differs elsewhere']
  }
  let last = ops.length - 1
  while (last > first && ops[last].sign === ' ') {
    last -= 1
  }
  const hunk = ops.slice(Math.max(0, first - 3), Math.min(ops.length, last + 4))
  const beforeCount = hunk.filter((op) => op.sign !== '+').length
  const afterCount = hunk.filter((op) => op.sign !== '-').length
  const lines = [
    `  --- ${beforeLabel}`,
    `  +++ ${afterLabel}`,
    `  @@ -${hunk[0].beforeLine},${beforeCount} +${hunk[0].afterLine},${afterCount} @@`,
    ...hunk.map((op) => `  ${op.sign}${op.line}`),
  ]
  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines), `  ... ${lines.length - maxLines} more diff line(s)`]
  }
  return lines
}

/** Line diff via a longest-common-subsequence table over the two texts. */
function diffLines(before, after) {
  const rows = before.length
  const columns = after.length
  const lengths = Array.from({ length: rows + 1 }, () => new Int32Array(columns + 1))
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[row][column] =
        before[row] === after[column]
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1])
    }
  }

  const ops = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      ops.push({ sign: ' ', line: before[row], beforeLine: row + 1, afterLine: column + 1 })
      row += 1
      column += 1
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      ops.push({ sign: '-', line: before[row], beforeLine: row + 1, afterLine: column + 1 })
      row += 1
    } else {
      ops.push({ sign: '+', line: after[column], beforeLine: row + 1, afterLine: column + 1 })
      column += 1
    }
  }
  while (row < rows) {
    ops.push({ sign: '-', line: before[row], beforeLine: row + 1, afterLine: column + 1 })
    row += 1
  }
  while (column < columns) {
    ops.push({ sign: '+', line: after[column], beforeLine: row + 1, afterLine: column + 1 })
    column += 1
  }
  return ops
}

function failUsage(message) {
  console.error(`error: ${message}`)
  console.error(USAGE)
  process.exit(1)
}

/**
 * Nothing is written before the first byte of a run is validated, so a refusal
 * always happens with an empty ledger.
 */
function refuse(reason) {
  console.error(`Refusing to generate fixtures: ${reason}`)
  console.error('Summary: written 0, skipped 0, refused 1')
  process.exit(1)
}
