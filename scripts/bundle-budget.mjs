#!/usr/bin/env node
/**
 * Fails the build when the bundle creeps back to the edge of Vite's warning.
 *
 * Vite only *warns* at 500 kB per chunk, which is how the entry ended up at
 * 499.60 kB — one screen away from the limit and nobody noticed. These budgets
 * are the numbers we actually want, not the numbers Vite tolerates.
 *
 * Budgets can be overridden for a one-off investigation:
 *   BUNDLE_BUDGET_ENTRY_KB=500 node scripts/bundle-budget.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = 'dist/assets'

/** KiB, not kB: sizes are compared against `statSync().size / 1024`. */
const BUDGETS = {
  entry: Number(process.env.BUNDLE_BUDGET_ENTRY_KB ?? 400),
  chunk: Number(process.env.BUNDLE_BUDGET_CHUNK_KB ?? 500),
  total: Number(process.env.BUNDLE_BUDGET_TOTAL_KB ?? 1100),
}

/** The chunk the browser needs before the app can paint anything useful. */
const EAGER_CHUNK = /^(index|react|rolldown-runtime)-.*\.js$/

function listAssets() {
  let entries
  try {
    entries = readdirSync(ASSETS_DIR)
  } catch {
    console.error(
      `bundle-budget: ${ASSETS_DIR} is missing. Run \`npm run build\` (or \`vite build\`) first.`,
    )
    process.exit(1)
  }

  return entries
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => ({ name, kib: statSync(join(ASSETS_DIR, name)).size / 1024 }))
    .sort((left, right) => right.kib - left.kib)
}

function format(kib) {
  return `${kib.toFixed(2)} KiB`
}

function main() {
  const assets = listAssets()
  const failures = []

  const entry = assets.find((asset) => /^index-.*\.js$/.test(asset.name))
  if (!entry) {
    console.error('bundle-budget: no entry chunk (index-*.js) found in', ASSETS_DIR)
    process.exit(1)
  }

  const rows = [
    {
      label: `entry ${entry.name}`,
      kib: entry.kib,
      budget: BUDGETS.entry,
      hint: 'split a vendor or lazy-load a panel',
    },
  ]

  for (const asset of assets) {
    if (asset === entry) {
      continue
    }
    rows.push({
      label: `${asset.name}`,
      kib: asset.kib,
      budget: BUDGETS.chunk,
      hint: 'no single chunk may reach the 500 KiB warning',
    })
  }

  const total = assets.reduce((sum, asset) => sum + asset.kib, 0)
  rows.push({ label: 'total emitted js + css', kib: total, budget: BUDGETS.total, hint: '' })

  for (const row of rows) {
    const over = row.kib > row.budget
    const suffix = over ? `FAIL  ${row.hint}` : 'ok'
    console.log(`${over ? '✗' : '✓'} ${row.label.padEnd(44)} ${format(row.kib).padStart(12)} / ${String(row.budget).padStart(4)} KiB  ${suffix}`)
    if (over) {
      failures.push(row)
    }
  }

  // A lazily imported chunk must never be preloaded by the entry, otherwise the
  // split bought nothing. Cheap guard: the heavy chunks are not in index.html.
  const preloaded = readIndexHtmlPreloads()
  const eagerlyPreloaded = assets.filter(
    (asset) => asset.kib > 100 && !EAGER_CHUNK.test(asset.name) && preloaded.has(asset.name),
  )
  for (const asset of eagerlyPreloaded) {
    console.log(`✗ ${asset.name} is preloaded from index.html (${format(asset.kib)})`)
    failures.push({ label: asset.name, kib: asset.kib, budget: 0, hint: 'preloaded' })
  }

  if (failures.length > 0) {
    console.error(`\nbundle-budget: ${failures.length} over budget.`)
    process.exit(1)
  }
  console.log('\nbundle-budget: within budget.')
}

function readIndexHtmlPreloads() {
  try {
    const html = readFileSync('dist/index.html', 'utf8')
    return new Set([...html.matchAll(/assets\/([\w.-]+\.js)/g)].map((match) => match[1]))
  } catch {
    return new Set()
  }
}

main()
