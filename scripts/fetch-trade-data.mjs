/**
 * Build the per-realm stat packs under packages/data/ from the official trade
 * APIs. Three realms ship the same schema as the international one:
 *
 *   intl  www.pathofexile.com  English            -> trade-stats.json
 *   cn    poe.game.qq.com      Simplified Chinese -> trade-stats.cn.json
 *   tw    pathofexile.tw       Traditional Chinese-> trade-stats.tw.json
 *
 * A pasted item is written in the language of the client it came from, so the
 * templates it is matched against have to come from the same realm. The stat
 * ids are shared across realms; only the `text` differs, which is exactly why
 * each realm needs its own precomputed skeleton.
 *
 * The API ships templates with `#` standing in for the rolled value
 * ("# to maximum Life", "火焰抗性 #%"). Matching a pasted item line against
 * those templates needs both sides reduced to the same skeleton, so this
 * script precomputes the skeleton and drops everything the lookup does not
 * need.
 *
 * It also pulls each realm's currency labels, so a listing priced in
 * "exalted" can be shown as 崇高石 / 神圣石 rather than the raw id.
 *
 * Usage: node scripts/fetch-trade-data.mjs [--realm intl|cn|tw] [--write]
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = resolve(ROOT, 'packages/data')
const UA = 'poe2-build-coach/0.3 (data pipeline; contact via github.com/chenhaolove89)'

/** The three trade realms the app can talk to. */
export const REALMS = {
  intl: { api: 'https://www.pathofexile.com/api/trade2', statsOut: 'trade-stats.json' },
  cn: { api: 'https://poe.game.qq.com/api/trade2', statsOut: 'trade-stats.cn.json' },
  tw: { api: 'https://pathofexile.tw/api/trade2', statsOut: 'trade-stats.tw.json' },
}

/**
 * "#% to Fire Resistance" -> "# to fire resistance", and the Chinese
 * equivalent "火焰抗性 #%" -> "火焰抗性 #".
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

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

async function buildStats(realm, api) {
  const payload = await get(`${api}/data/stats`)
  const stats = []
  for (const group of payload.result ?? []) {
    if (!USEFUL_GROUPS.includes(group.id)) continue
    for (const entry of group.entries ?? []) {
      // A few templates carry an embedded newline (map implicits); flatten
      // them so the skeleton stays a single comparable line.
      stats.push({ id: entry.id, t: group.id, k: skeleton(String(entry.text).replace(/\s+/g, ' ')) })
    }
  }
  // The API does not promise an order, so sort rather than let the pack churn
  // on every refresh. It also makes the tiebreak in matchStat.pick()
  // deterministic: same skeleton and same group now resolves to the lowest id.
  stats.sort((a, b) => a.k.localeCompare(b.k) || a.t.localeCompare(b.t) || a.id.localeCompare(b.id))
  return {
    source: `${api.replace('https://', '')}/data/stats (official, read-only)`,
    realm,
    leagueAgnostic: true,
    fetched: new Date().toISOString().slice(0, 10),
    stats,
  }
}

/**
 * Currency ids are language-independent ("exalted"), so each realm's labels
 * are what turn them into something a player recognises.
 */
async function buildCurrency(realm, api) {
  const payload = await get(`${api}/data/static`)
  const currencies = {}
  for (const group of payload.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id && entry.text) currencies[entry.id] = entry.text
    }
  }
  return {
    source: `${api.replace('https://', '')}/data/static (official, read-only)`,
    realm,
    fetched: new Date().toISOString().slice(0, 10),
    currencies,
  }
}

const write = process.argv.includes('--write')
const only = process.argv[process.argv.indexOf('--realm') + 1]
const selected = process.argv.includes('--realm') ? [only] : Object.keys(REALMS)

for (const realm of selected) {
  const { api, statsOut } = REALMS[realm]
  if (!api) {
    console.error(`unknown realm: ${realm} (expected one of ${Object.keys(REALMS).join(', ')})`)
    process.exit(1)
  }

  const pack = await buildStats(realm, api)
  const currency = await buildCurrency(realm, api)
  const statsPath = resolve(DATA, statsOut)
  const currencyPath = resolve(DATA, statsOut.replace('trade-stats', 'trade-currency'))

  console.log(`${realm}: ${pack.stats.length} stats, ${Object.keys(currency.currencies).length} currency labels`)
  console.log(`  -> ${statsPath} (${(JSON.stringify(pack).length / 1024).toFixed(0)} KB)`)
  console.log(`  -> ${currencyPath} (${(JSON.stringify(currency).length / 1024).toFixed(0)} KB)`)

  if (write) {
    writeFileSync(statsPath, JSON.stringify(pack))
    writeFileSync(currencyPath, JSON.stringify(currency))
  }
}

console.log(write ? 'written' : '(dry run — pass --write to update)')
