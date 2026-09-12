import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function loadFixtures<T>(relativeDir: string): T[] {
  const dir = path.join(process.cwd(), relativeDir)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T)
}
