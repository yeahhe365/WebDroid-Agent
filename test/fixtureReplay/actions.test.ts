import { describe, expect, it } from 'vitest'
import { parseModelAction } from '../../src/lib/actionParser'
import { FIXTURE_SCHEMA_VERSION } from '../../src/lib/trajectoryFixture'
import type { ActionFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<ActionFixture>('test/fixtures/actions')

describe('action fixtures', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it('carries the current schema version and kind on every fixture', () => {
    for (const fixture of fixtures) {
      expect(fixture.schemaVersion, fixture.name).toBe(FIXTURE_SCHEMA_VERSION)
      expect(fixture.kind, fixture.name).toBe('webdroid.action-fixture')
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.name} (${fixture.source})`, () => {
      if ('error' in fixture.expected) {
        expect(() =>
          parseModelAction(fixture.input.modelOutput, fixture.input.screen, fixture.input.actionProtocol),
        ).toThrowError(new RegExp(fixture.expected.error.messageIncludes, 'i'))
        return
      }
      const action = parseModelAction(
        fixture.input.modelOutput,
        fixture.input.screen,
        fixture.input.actionProtocol,
      )
      expect(action).toEqual(fixture.expected.action)
    })
  }
})
