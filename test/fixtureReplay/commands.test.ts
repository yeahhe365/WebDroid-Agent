import { describe, expect, it } from 'vitest'
import { buildSetClipboardCommand } from '../../src/adapters/inputCommands'
import { buildDumpScreenTreeCommand } from '../../src/adapters/uiAutomator'
import { FIXTURE_SCHEMA_VERSION } from '../../src/lib/trajectoryFixture'
import type { CommandFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<CommandFixture>('test/fixtures/commands')

const BUILDERS: Record<string, (action: never) => readonly string[]> = {
  set_clipboard: (action: { text: string }) => buildSetClipboardCommand(action.text),
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
    it(`${fixture.name} still builds the recorded argv`, () => {
      const build = BUILDERS[fixture.input.action.action]
      expect(build, `no builder registered for ${fixture.input.action.action}`).toBeDefined()
      expect(build?.(fixture.input.action as never)).toEqual(fixture.expected.argv)
    })

    it(`${fixture.name} keeps shell metacharacters inside quoted arguments`, () => {
      const build = BUILDERS[fixture.input.action.action]
      const argv = build?.(fixture.input.action as never) ?? []
      for (const token of argv) {
        expect(token).not.toBe(';')
        expect(token).not.toBe('&&')
      }
    })
  }
})
