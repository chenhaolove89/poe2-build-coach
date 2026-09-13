/**
 * Fetch Simplified-Chinese item base / unique names from poe2db.tw and merge
 * them into packages/data/name-zh.json.
 *
 * Item pages render every entry as an anchor whose href is the English name
 * with underscores and whose text is the Chinese name, e.g.
 *   <a class="whiteitem Helmet" href="Ancient_Visor">远古面甲</a>
 * so the pairs can be read straight off the page without following hovers.
 *
 * Usage: node scripts/fetch-item-names.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'packages/data/name-zh.json')
const BASE = 'https://poe2db.tw/cn/'

const PAGES = [
  'Ancient_Armour',
  'Body_Armours',
  'Boots',
  'Bucklers',
  'Charms',
  'Claws',
  'Crossbows',
  'Daggers',
  'Foci',
  'Gloves',
  'Helmets',
  'Jewels',
  'One_Hand_Axes',
  'One_Hand_Maces',
  'One_Hand_Swords',
  'Quarterstaves',
  'Quivers',
  'Rings',
  'Amulets',
  'Belts',
  'Sceptres',
  'Shields',
  'Spears',
  'Staves',
  'Tinctures',
  'Two_Hand_Axes',
  'Two_Hand_Maces',
  'Two_Hand_Swords',
  'Wands',
  'Flasks',
  'Soul_Cores',
  'Unique_item',
  'Unique_Weapons',
  'Unique_Armours',
  'Unique_Jewellery',
]

/**
 * Anchors that point at an item page carry both names. Attribute filtering
 * matters: stat links ("Physical Damage" → "物理") sit in the same table and
 * would otherwise overwrite the dictionary with truncated readings.
 */
const ANCHOR = /<a([^>]*)>([^<]{1,48})<\/a>/g

function itemName(attrs, text) {
  const zh = text.trim()
  if (!zh || !/[\u4e00-\u9fff]/.test(zh)) return null
  const hover = attrs.match(/data-hover="([^"]*)"/)?.[1] ?? ''
  const cls = attrs.match(/class="([^"]*)"/)?.[1] ?? ''
  const href = attrs.match(/href="([^"]*)"/)?.[1]
  const looksLikeItem =
    /BaseItemTypes_hover|UniqueItems_hover|UniqueArmours_hover/.test(hover) ||
    /\bwhiteitem\b|\buniqueitem\b/i.test(cls)
  if (!looksLikeItem || !href) return null
  if (href.includes('.') || href.includes('%') || href.includes('/')) return null
  const en = decodeURIComponent(href).replace(/_/g, ' ').trim()
  if (en.length < 3 || /^\d/.test(en)) return null
  return { en, zh }
}

function parsePage(html) {
  const found = {}
  for (const [, attrs, text] of html.matchAll(ANCHOR)) {
    const pair = itemName(attrs, text)
    if (!pair) continue
    // Keep the first reading; later pages repeat the same base under variants.
    if (!(pair.en in found)) found[pair.en] = pair.zh
  }
  return found
}

const merged = {}
for (const page of PAGES) {
  let res
  try {
    res = await fetch(BASE + page, { headers: { 'user-agent': 'poe2coach-data-pipeline' } })
  } catch (error) {
    console.error(`skip ${page}: ${error.message}`)
    continue
  }
  if (!res.ok) continue
  const parsed = parsePage(await res.text())
  const count = Object.keys(parsed).length
  if (count > 0) console.log(`${page}: ${count} entries`)
  Object.assign(merged, parsed)
}

const pack = JSON.parse(readFileSync(OUT, 'utf8'))
let added = 0
for (const [en, zh] of Object.entries(merged)) {
  if (!(en in pack.names)) added++
  pack.names[en] = zh
}
// Corrections the upstream dictionaries carry wrong; must survive every re-run.
const OVERRIDES = { Attribute: '属性' }
Object.assign(pack.names, OVERRIDES)
console.log(`item table: ${Object.keys(merged).length} total, ${added} new`)
console.log(`name-zh.json: ${Object.keys(pack.names).length} entries`)
pack.source =
  'poe-ninja-pob-zh dict.json (poe2db.tw derived, t2s) + poe2db.tw gem index + poe2db.tw item index'

if (process.argv.includes('--write')) {
  writeFileSync(OUT, JSON.stringify(pack, null, 1) + '\n')
  console.log('written', OUT)
} else {
  console.log('(dry run — pass --write to update)')
}
