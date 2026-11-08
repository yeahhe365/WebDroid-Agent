import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURE_SCHEMA_VERSION } from '../src/lib/trajectoryFixture'

const repoRoot = process.cwd()
const readRepoFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8')

/**
 * Every `.json` under `relativeDir` at any depth. Fixtures live one level down
 * today (`test/fixtures/actions/...`), but a guard that only read the top level
 * would silently stop covering a fixture tree nested any deeper.
 */
function collectJsonFiles(relativeDir: string): string[] {
  const dir = path.join(repoRoot, relativeDir)
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      return collectJsonFiles(child)
    }
    return entry.name.endsWith('.json') ? [child] : []
  })
}

describe('repository hardening guards', () => {
  it('ships no CSP meta tag, so the header policy stays authoritative', () => {
    const html = readRepoFile('index.html')
    expect(html).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i)
  })

  it('provides static-host security headers alongside the built site', () => {
    const headers = readRepoFile('public/_headers')
    expect(headers).toContain('Content-Security-Policy:')
    expect(headers).toContain('connect-src')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('X-Frame-Options: DENY')
  })

  it('allows the external origins the UI fetches directly', () => {
    const headers = readRepoFile('public/_headers')
    expect(headers).toContain('https://api.github.com')
    expect(headers).toContain('https://raw.githubusercontent.com')
  })

  it('compiles the frontend under TypeScript strict mode', () => {
    // tsconfig files are JSONC (they carry comments), so strip them first.
    const source = readRepoFile('tsconfig.app.json')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const tsconfig = JSON.parse(source) as { compilerOptions?: { strict?: boolean } }
    expect(tsconfig.compilerOptions?.strict).toBe(true)
  })
})

describe('fixture guards', () => {
  it('never commits real screenshot pixels into fixtures', () => {
    for (const file of collectJsonFiles('test/fixtures')) {
      const content = readFileSync(path.join(repoRoot, file), 'utf8')
      expect(content, file).not.toContain('data:image')
    }
  })

  it('stamps every fixture with a schema version', () => {
    // Cross-check the constant against the literal a human confirmed, so that
    // bumping the fixture module re-opens this guard instead of silently
    // re-blessing every committed fixture.
    expect(FIXTURE_SCHEMA_VERSION).toBe(1)
    const files = collectJsonFiles('test/fixtures')
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
        schemaVersion?: number
      }
      expect(fixture.schemaVersion, file).toBe(FIXTURE_SCHEMA_VERSION)
    }
  })
})
