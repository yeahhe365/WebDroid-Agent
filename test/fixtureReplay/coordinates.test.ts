import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../../src/lib/actionTypes'
import { mapActionCoordinates } from '../../src/lib/screenshot/coordinates'
import { FIXTURE_SCHEMA_VERSION } from '../../src/lib/trajectoryFixture'
import type { CoordinateFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<CoordinateFixture>('test/fixtures/coordinates')

/**
 * Every coordinate a mapped action actually carries: one point for
 * `tap`/`long_press`/`double_tap`, both endpoints for a swipe. A fixture that
 * maps to no point at all is a broken fixture, so the bounds test below asserts
 * a non-empty result instead of passing vacuously.
 */
function mappedPoints(action: AgentAction): Array<[number, number]> {
  if ('x' in action && 'y' in action) {
    return [[action.x, action.y]]
  }
  if ('fromX' in action && 'fromY' in action && 'toX' in action && 'toY' in action) {
    return [
      [action.fromX, action.fromY],
      [action.toX, action.toY],
    ]
  }
  return []
}

describe('coordinate fixtures', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it('carries the current schema version and kind on every fixture', () => {
    for (const fixture of fixtures) {
      expect(fixture.schemaVersion, fixture.name).toBe(FIXTURE_SCHEMA_VERSION)
      expect(fixture.kind, fixture.name).toBe('webdroid.coordinate-fixture')
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.name} matches the recorded mapping`, () => {
      const mapped = mapActionCoordinates(
        fixture.input.action,
        fixture.input.fromScreen,
        fixture.input.toScreen,
      )
      expect(mapped).toEqual(fixture.expected.action)
    })

    it(`${fixture.name} stays inside the target screen`, () => {
      const mapped = mapActionCoordinates(
        fixture.input.action,
        fixture.input.fromScreen,
        fixture.input.toScreen,
      )
      const points = mappedPoints(mapped)
      expect(points.length, `${fixture.name} maps to no coordinate`).toBeGreaterThan(0)
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(fixture.input.toScreen.width - 1)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(fixture.input.toScreen.height - 1)
      }
    })
  }

  it('is the identity when both screens are the same size', () => {
    const fixture = fixtures.find((candidate) => candidate.name === 'identity')
    expect(fixture).toBeDefined()
    expect(fixture?.expected.action).toEqual(fixture?.input.action)
  })
})
