// Dead-CSS audit: reports rules in src/styles/*.css whose classes are no longer
// referenced from any ts/tsx/html file.
//
// How it decides:
// - a selector is dead when ANY of its classes is dead (`.a.b` cannot match if
//   `a` is gone); comma lists are judged per selector;
// - a class counts as live when it appears literally in production code or when
//   a template literal could build it (e.g. `button--${variant}`, `status-${x}`).
//
// The template heuristic keeps some rules alive that cannot actually match
// (for example `.chat-send.button--primary`, because `button--${variant}` exists
// elsewhere). Treat the output as a worklist to confirm by hand, then delete the
// rules and update any CSS contract assertions in tests that reference them.
//
// Usage: npm run css:audit
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const stylesDir = path.join(root, 'src/styles')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (['node_modules', '.git', 'dist', 'dist-server'].includes(entry)) continue
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const codeFiles = walk(root).filter((file) => /\.(ts|tsx|html)$/.test(file) && !file.includes('/styles/'))
const prod = codeFiles.filter((file) => !/\.test\.tsx?$/.test(file)).map((f) => readFileSync(f, 'utf8')).join('\n')
const tests = codeFiles.filter((file) => /\.test\.tsx?$/.test(file)).map((f) => readFileSync(f, 'utf8')).join('\n')

// Classes that any template literal could still produce. Templates build whole
// className strings, so each whitespace-separated fragment is a candidate token.
const dynamicPatterns = []
for (const match of prod.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
  const parts = match[1].split(/\$\{[^}]*\}/g)
  if (!parts.some((part) => part.replace(/[^\w-]/g, '').length >= 4)) continue
  const pattern = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\w-]*')
  for (const fragment of pattern.split(/\s+/).filter(Boolean)) {
    // Ignore fragments that are pure wildcards: they would match every class.
    const literal = fragment.replace(/\[\\w-\]\*/g, '')
    if (literal.length < 3) continue
    dynamicPatterns.push(new RegExp(fragment))
  }
}
const dynamicCache = new Map()
const isDynamic = (name) => {
  if (!dynamicCache.has(name)) {
    dynamicCache.set(name, dynamicPatterns.some((pattern) => pattern.test(name)))
  }
  return dynamicCache.get(name)
}

const isLive = (name) => prod.includes(name) || isDynamic(name)

function extractRules(css) {
  const rules = []
  let buffer = ''
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i]
    if (char === '{') {
      const prelude = buffer.trim()
      buffer = ''
      if (prelude.startsWith('@')) continue
      let depth = 1
      let j = i + 1
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1
        else if (css[j] === '}') depth -= 1
        j += 1
      }
      rules.push({ selector: prelude, body: css.slice(i + 1, j - 1), start: i - prelude.length - 1, end: j })
      i = j - 1
      continue
    }
    if (char === '}') {
      buffer = ''
      continue
    }
    if (char === ';' && buffer.trim().startsWith('@')) {
      buffer = ''
      continue
    }
    buffer += char
  }
  return rules
}

const classesOf = (selector) => selector.match(/\.[A-Za-z_][\w-]*/g)?.map((c) => c.slice(1)) ?? []
const splitSelectors = (selector) =>
  selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

let totalDeadLines = 0
for (const name of readdirSync(stylesDir).filter((n) => n.endsWith('.css'))) {
  const css = readFileSync(path.join(stylesDir, name), 'utf8')
  const rules = extractRules(css)
  const fullDead = []
  const partialDead = []
  for (const rule of rules) {
    const selectors = splitSelectors(rule.selector.replace(/\/\*[\s\S]*?\*\//g, ''))
    if (selectors.length === 0) continue
    const dead = selectors.filter((selector) => {
      const classes = classesOf(selector)
      return classes.length > 0 && classes.some((cls) => !isLive(cls))
    })
    if (dead.length === 0) continue
    if (dead.length === selectors.length) fullDead.push({ ...rule, selectors })
    else partialDead.push({ ...rule, dead, selectors })
  }
  if (fullDead.length === 0 && partialDead.length === 0) continue
  const lines = fullDead.reduce((total, rule) => total + rule.body.split('\n').length + 1, 0)
  totalDeadLines += lines
  console.log(`\n=== ${name}: ${fullDead.length} fully dead rules (~${lines} lines), ${partialDead.length} with dead selectors`)
  for (const rule of fullDead) console.log(`  DELETE RULE: ${rule.selectors.join(', ')}`)
  for (const rule of partialDead) console.log(`  DROP SELECTOR: ${rule.dead.join(', ')}   (rule keeps: ${rule.selectors.filter((s) => !rule.dead.includes(s)).join(', ')})`)
}
console.log(`\nTotal fully dead declaration lines: ~${totalDeadLines}`)
