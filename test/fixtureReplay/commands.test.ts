import { describe, expect, it } from 'vitest'
import { buildSetClipboardCommand } from '../../src/adapters/inputCommands'
import { buildDumpScreenTreeCommand } from '../../src/adapters/uiAutomator'
import { FIXTURE_SCHEMA_VERSION } from '../../src/lib/trajectoryFixture'
import type { CommandFixture, CommandFixtureSource } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<CommandFixture>('test/fixtures/commands')

/**
 * The key type is `CommandFixtureSource['action']`, so a fixture action outside
 * that union is a compile error in `trajectoryFixture.ts` instead of a silently
 * unreplayable JSON file. Each builder therefore takes the whole union and
 * discriminates on it itself: typing each one as its own member reads better,
 * but TypeScript cannot correlate `BUILDERS[action.action]` with `action` across
 * a union key (the indexed access degrades to `never`), which is exactly what
 * forced the old `as never` casts.
 *
 * The `Object.hasOwn` guard below is still needed: `loadFixtures` casts raw JSON,
 * so a hand-written fixture (or a future generated one) can carry an action the
 * union does not know yet, and it must fail loudly rather than call `undefined`.
 */
const BUILDERS: Record<
  CommandFixtureSource['action'],
  (action: CommandFixtureSource) => readonly string[]
> = {
  set_clipboard: (action) =>
    action.action === 'set_clipboard' ? buildSetClipboardCommand(action.text) : [],
  dump_screen_tree: () => buildDumpScreenTreeCommand(),
}

describe('command fixtures', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it('carries the current schema version and kind on every fixture', () => {
    for (const fixture of fixtures) {
      expect(fixture.schemaVersion, fixture.name).toBe(FIXTURE_SCHEMA_VERSION)
      expect(fixture.kind, fixture.name).toBe('webdroid.command-fixture')
    }
  })

  for (const fixture of fixtures) {
    const action = fixture.input.action

    it(`${fixture.name} still builds the recorded argv`, () => {
      if (!Object.hasOwn(BUILDERS, action.action)) {
        throw new Error(`no builder registered for ${action.action}`)
      }
      expect(BUILDERS[action.action](action)).toEqual(fixture.expected.argv)
    })

    it(`${fixture.name} keeps shell metacharacters inside quoted arguments`, () => {
      if (!Object.hasOwn(BUILDERS, action.action)) {
        throw new Error(`no builder registered for ${action.action}`)
      }
      for (const token of BUILDERS[action.action](action)) {
        expect(token).not.toBe(';')
        expect(token).not.toBe('&&')
      }
    })
  }
})
