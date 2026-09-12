import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const readRepoFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8')

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

  it('compiles the frontend under TypeScript strict mode', () => {
    // tsconfig files are JSONC (they carry comments), so strip them first.
    const source = readRepoFile('tsconfig.app.json')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const tsconfig = JSON.parse(source) as { compilerOptions?: { strict?: boolean } }
    expect(tsconfig.compilerOptions?.strict).toBe(true)
  })
})
