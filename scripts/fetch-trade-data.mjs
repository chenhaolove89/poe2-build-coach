/**
 * Build packages/data/trade-stats.json from the official trade API stat index.
 *
 * The API ships stat templates in English with `#` standing in for the rolled
 * value ("# to maximum Life"). Matching a pasted item line against those
 * templates needs both sides reduced to the same skeleton, so this script
 * precomputes the skeleton and drops everything the lookup does not need.
 *
 * Usage: node scripts/fetch-trade-data.mjs [--write]
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'packages/data/trade-stats.json')
const API = 'https://www.pathofexile.com/api/trade2/data/stats'
const UA = 'poe2-build-coach/0.3 (data pipeline; contact via github.com/chenhaolove89)'

/**
 * "#% to Fire Resistance" -> "# to fire resistance".
 *
 * The app applies the same reduction to the rolled value ("+45% to Fire
 * Resistance" -> "# to fire resistance"), which is what makes a pasted item
 * line comparable to the template. Keep this in sync with
 * packages/core/src/trade/skeleton.ts — a test pins them together.
 */
export function skeleton(text) {
  return text
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Groups worth matching against a pasted rare/unique item. */
const USEFUL_GROUPS = ['explicit', 'implicit', 'fractured', 'crafted', 'enchant', 'rune', 'desecrated']

const res = await fetch(API, { headers: { 'user-agent': UA } })
if (!res.ok) {
  console.error(`stat index fetch failed: HTTP ${res.status}`)
  process.exit(1)
}
const payload = await res.json()

const stats = []
for (const group of payload.result ?? []) {
  if (!USEFUL_GROUPS.includes(group.id)) continue
  for (const entry of group.entries ?? []) {
    stats.push({ id: entry.id, t: group.id, k: skeleton(entry.text) })
  }
}

const pack = {
  source: 'pathofexile.com/api/trade2/data/stats (official, read-only)',
  leagueAgnostic: true,
  fetched: new Date().toISOString().slice(0, 10),
  stats,
}

const bytes = JSON.stringify(pack).length
console.log(`stats: ${stats.length} (groups: ${USEFUL_GROUPS.join(', ')})`)
console.log(`output: ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`)

if (process.argv.includes('--write')) {
  writeFileSync(OUT, JSON.stringify(pack))
  console.log('written')
} else {
  console.log('(dry run — pass --write to update)')
}
