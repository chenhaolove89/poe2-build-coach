/**
 * Fetch Simplified-Chinese gem names from poe2db.tw and merge them into
 * packages/data/name-zh.json.
 *
 * The community dict.json used for the initial table covers passive-tree and
 * item nouns but not the gem index, so support/spirit/lineage gems render in
 * English. poe2db's Chinese pages carry a per-row `data-filters` attribute that
 * ends with the English gem name and an anchor whose text is the Chinese one.
 *
 * Usage: node scripts/fetch-gem-names.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'packages/data/name-zh.json')
const PAGES = ['Skill_Gems', 'Support_Gems', 'Spirit_Gems', 'Lineage_Supports']
const BASE = 'https://poe2db.tw/cn/'

/** Row label looks like "辅助 血统 召唤生物 Amanamu's Tithe" — take the trailing English run. */
function englishName(label) {
  const m = label.match(/([A-Za-z][A-Za-z0-9'’\- ]*)$/)
  return m ? m[1].trim().replace(/’/g, "'") : null
}

/** poe2db lists tiered variants ("Deadly Poison I"); PoB2 stores the bare name. */
function baseName(name) {
  return name.replace(/\s+(I{1,3}|IV|V)$/, '').trim()
}

/** Gems whose poe2db entry lags the live league, so the index has no Chinese row. */
const OVERRIDES = {
  'Arcane Tempo': '秘法节奏',
  'Martial Tempo': '武术节奏',
  'Cast on Crit': '暴击时施放',
  'Cast on Critical Strike': '暴击时施放',
  'Concentrated Effect': '集中效应',
  // The 293 generic tree nodes read "Attribute" in PoB2; in-game the node is 属性.
  Attribute: '属性',
}

function parsePage(html) {
  const found = { ...OVERRIDES }
  for (const row of html.matchAll(/<tr data-filters="([^"]*)">/g)) {
    const segment = html.slice(row.index, row.index + 900)
    const zh = segment.match(/href="\/cn\/[^"]+"[^>]*>([^<]{1,40})<\/a>/)?.[1]?.trim()
    const en = englishName(row[1])
    if (!en || !zh || !/[\u4e00-\u9fff]/.test(zh)) continue
    if (en.length < 3) continue
    found[en] = zh
    const base = baseName(en)
    if (base && base !== en && !(base in found)) found[base] = zh.replace(/\s*(I{1,3}|IV|V)$/, '')
  }
  return found
}

const merged = {}
for (const page of PAGES) {
  const res = await fetch(BASE + page, { headers: { 'user-agent': 'poe2coach-data-pipeline' } })
  if (!res.ok) {
    console.error(`skip ${page}: HTTP ${res.status}`)
    continue
  }
  const parsed = parsePage(await res.text())
  console.log(`${page}: ${Object.keys(parsed).length} names`)
  Object.assign(merged, parsed)
}

const pack = JSON.parse(readFileSync(OUT, 'utf8'))
let added = 0
let changed = 0
for (const [en, zh] of Object.entries(merged)) {
  if (!(en in pack.names)) added++
  else if (pack.names[en] !== zh) changed++
  pack.names[en] = zh
}
console.log(`gem table: ${Object.keys(merged).length} total, ${added} new, ${changed} rewritten`)
console.log(`name-zh.json: ${Object.keys(pack.names).length} entries`)
pack.source = 'poe-ninja-pob-zh dict.json (poe2db.tw derived, t2s) + poe2db.tw gem index'

if (process.argv.includes('--write')) {
  writeFileSync(OUT, JSON.stringify(pack, null, 1) + '\n')
  console.log('written', OUT)
} else {
  console.log('(dry run — pass --write to update)')
}
