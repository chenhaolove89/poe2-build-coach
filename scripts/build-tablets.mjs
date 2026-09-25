// Build packages/data/tablets.json from the poe2db tablet pages.
//
//   https://poe2db.tw/us/Breach_Tablet  (+ /cn/ and /tw/ for the two Chinese realms)
//
// Tablets (石板/碑牌) are the map-device items that add per-map modifiers — the
// per-run counterpart of the atlas tree. GGG publishes no export for them, and
// the datamined dumps that carry the atlas tree stop short: RePoE's poe2
// base_items.json predates the endgame (no waystones, no tablets) and PoB2 has
// no tablet files. poe2db carries the full affix pool per tablet class, embedded
// as JSON in the page itself, in all three languages the app speaks — its text
// is datamined game data (same category of source as the atlas tree's
// repoe-fork dump, credited to GGG).
//
// What the page gives us, per class and per language: every affix with its
// generation (prefix/suffix), its mod families, and its text with roll ranges —
// plus the base box: the class's implicit line and its uses. The mechanic each
// tablet class belongs to is read off the affix families themselves
// (BreachXxx -> the Breach subtree), with the class-level mapping in TABLETS.
//
// The generic pool is *computed*, not authored: the families shared by all
// eight classes. A mod is generic when every family it belongs to is in that
// intersection; everything else is that class's mechanic pool.
//
// Usage: node scripts/build-tablets.mjs [--refresh]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.tmp', 'tablet-src')
const OUT = join(ROOT, 'packages', 'data', 'tablets.json')
const REFRESH = process.argv.includes('--refresh')

const BASE = 'https://poe2db.tw'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TRADE_ITEMS_URL = 'https://www.pathofexile.com/api/trade2/data/items'

// The eight tablet classes, in the order the official trade index lists them.
// `subtree` is the atlas tree's mechanic subtree this tablet belongs to (null
// where the game has none: the Overseer tablet is about the map boss, the
// Irradiated tablet carries only the generic pool). The evidence is in the
// affix families each page carries — BreachXxx, IncursionXxx, RitualXxx…
const TABLETS = [
  { id: 'abyss', slug: 'Abyss', subtree: 'Abyss' },
  { id: 'breach', slug: 'Breach', subtree: 'Breach' },
  { id: 'delirium', slug: 'Delirium', subtree: 'Delirium' },
  { id: 'expedition', slug: 'Expedition', subtree: 'Expedition' },
  { id: 'irradiated', slug: 'Irradiated', subtree: null },
  { id: 'temple', slug: 'Temple', subtree: 'Incursion' },
  { id: 'overseer', slug: 'Overseer', subtree: null },
  { id: 'ritual', slug: 'Ritual', subtree: 'Ritual' },
]

// The uses marker in each page language, and the words that name the class in
// the base box ("Tablet" the kind line for English, 石板 for 国服, 碑牌 for 台服).
const LANGS = {
  us: { usesMarker: 'uses remaining', kind: 'Tablet' },
  cn: { usesMarker: '剩余次数', kind: '石板' },
  // "剩餘" rather than the fuller wording, which some classes shorten
  // ("次使用次數" vs "次使用").
  tw: { usesMarker: '剩餘', kind: '碑牌' },
}

async function cachedPage(name, url) {
  const file = join(CACHE, name)
  if (existsSync(file) && !REFRESH) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('"normal":[')) return text
  }
  mkdirSync(CACHE, { recursive: true })
  // poe2db sits behind Cloudflare and throttles bursts; a single retry after a
  // pause clears the occasional 52x without hammering.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })
      const text = await res.text()
      if (!res.ok || !text.includes('"normal":[')) throw new Error(`${url} -> ${res.status}, ${text.length} bytes`)
      writeFileSync(file, text)
      return text
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 4000 * attempt))
    }
  }
}

/** Extract the `normal:[...]` affix array poe2db embeds in the page. */
function extractMods(html) {
  const i = html.indexOf('"normal":[')
  if (i < 0) throw new Error('page carries no affix JSON')
  let s = html.indexOf('[', i)
  let depth = 0
  let inStr = false
  let esc = false
  for (let p = s; p < html.length; p++) {
    const c = html[p]
    if (esc) {
      esc = false
      continue
    }
    if (c === '\\') {
      esc = true
      continue
    }
    if (c === '"') inStr = !inStr
    if (inStr) continue
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return JSON.parse(html.slice(s, p + 1))
    }
  }
  throw new Error('unterminated affix JSON')
}

/** poe2db joins an affix's lines with <br>; strip the rest of the markup. */
function cleanText(str) {
  return str
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u2014/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * The base box: class name, implicit line, uses. The anchor is the use-count
 * wording in each language; the box ends with [..., uses, marker], and the
 * class's kind line ("Tablet"/石板/碑牌) sits just before the implicit.
 */
function extractBase(html, lang) {
  const { usesMarker, kind } = LANGS[lang]
  const anchor = html.indexOf(usesMarker)
  if (anchor < 0) throw new Error(`no ${usesMarker} marker`)
  const lines = html
    .slice(Math.max(0, anchor - 6000), anchor + 120)
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const anchorIdx = lines.findIndex((l) => l.includes(usesMarker))
  // The count sits beside the marker in every language, but on a different
  // side: English "10 | uses remaining", 国服 "剩余次数： | 10", 台服 "剩餘 | 10 | 次使用".
  const uses = Number(lines[anchorIdx - 1]) || Number(lines[anchorIdx + 1])
  if (!Number.isFinite(uses)) throw new Error(`no uses count beside ${usesMarker}`)
  // Walk back over the implicit fragments to the kind line; everything between
  // the two is the implicit, minus the count wording itself.
  const kindIdx = lines.lastIndexOf(kind, anchorIdx - 2)
  if (kindIdx < 0) throw new Error(`no ${kind} kind line`)
  const name = lines[kindIdx - 1] ?? ''
  const implicit = lines
    .slice(kindIdx + 1, anchorIdx)
    .filter((l) => l !== '剩餘' && l !== '剩余' && l !== String(uses))
    .join(' ')
  if (!name || !implicit) throw new Error('base box incomplete')
  return { name, implicit, uses }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- fetch & align

const pages = {}
for (const t of TABLETS) {
  for (const [lang, def] of Object.entries(LANGS)) {
    process.stderr.write(`fetching ${t.slug} ${lang}\n`)
    pages[`${t.slug}:${lang}`] = await cachedPage(`${t.slug}-${lang}.html`, `${BASE}/${lang}/${t.slug}_Tablet`)
    await sleep(1200)
  }
}

const baked = TABLETS.map((t) => {
  const bases = {}
  const mods = {}
  for (const lang of Object.keys(LANGS)) {
    bases[lang] = extractBase(pages[`${t.slug}:${lang}`], lang)
    mods[lang] = extractMods(pages[`${t.slug}:${lang}`])
  }
  // The three languages render the same pool: same length, and every entry
  // shares its generation and families. Anything else means poe2db changed and
  // the file must not be written on a guess.
  const { us, cn, tw } = mods
  if (cn.length !== us.length || tw.length !== us.length) {
    throw new Error(`${t.slug}: pool lengths differ (us ${us.length}, cn ${cn.length}, tw ${tw.length})`)
  }
  us.forEach((m, i) => {
    for (const other of [cn[i], tw[i]]) {
      if (other.ModGenerationTypeID !== m.ModGenerationTypeID) {
        throw new Error(`${t.slug}[${i}]: generation differs across languages`)
      }
      if (JSON.stringify(other.ModFamilyList) !== JSON.stringify(m.ModFamilyList)) {
        throw new Error(`${t.slug}[${i}]: families differ across languages`)
      }
    }
  })
  return { t, bases, mods: us.map((m, i) => ({ us: m, cn: cn[i], tw: tw[i] })) }
})

// The generic pool is what every class shares.
const shared = baked
  .map(({ mods }) => new Set(mods.flatMap((m) => m.us.ModFamilyList ?? [])))
  .reduce((acc, set) => new Set([...acc].filter((f) => set.has(f))))

const tablets = baked.map(({ t, bases, mods }) => {
  const affixes = mods
    .map(({ us, cn, tw }) => ({
      gen: Number(us.ModGenerationTypeID),
      families: us.ModFamilyList ?? [],
      name: { en: us.Name, 'zh-Hans': cn.Name, 'zh-Hant': tw.Name },
      text: { en: cleanText(us.str), 'zh-Hans': cleanText(cn.str), 'zh-Hant': cleanText(tw.str) },
    }))
    .map((m) => ({ ...m, generic: m.families.length > 0 && m.families.every((f) => shared.has(f)) }))
    .sort((a, b) => a.gen - b.gen || a.name.en.localeCompare(b.name.en))
  return {
    id: t.id,
    subtree: t.subtree,
    tradeType: bases.us.name,
    name: { en: bases.us.name, 'zh-Hans': bases.cn.name, 'zh-Hant': bases.tw.name },
    implicit: { en: bases.us.implicit, 'zh-Hans': bases.cn.implicit, 'zh-Hant': bases.tw.implicit },
    uses: bases.us.uses,
    affixes,
  }
})

// Unique tablets, straight off the official trade index (the one ranking the
// app's price checks already trusts).
const tradeItems = await (async () => {
  const res = await fetch(TRADE_ITEMS_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${TRADE_ITEMS_URL} -> ${res.status}`)
  return res.json()
})()
const uniques = (tradeItems.result ?? [])
  .flatMap((g) => g.entries ?? [])
  .filter((e) => typeof e.type === 'string' && e.type.endsWith('Tablet') && e.flags?.unique && e.name)
  .map((e) => ({ name: e.name, tradeType: e.type }))

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: 'poe2db.tw tablet pages (us/cn/tw) — datamined game affix data, (c) GGG. Unique names from the official trade2 item index.',
      captured: new Date().toISOString().slice(0, 10),
      genericFamilies: [...shared].sort(),
      tablets,
      uniques,
    },
    null,
    1,
  ),
)
const genericCount = tablets.reduce((n, t) => n + t.affixes.filter((a) => a.generic).length, 0)
console.log(
  `wrote ${OUT}: ${tablets.length} classes, ${tablets.reduce((n, t) => n + t.affixes.length, 0)} affixes ` +
    `(${genericCount} generic), ${uniques.length} uniques, ${shared.size} shared families`,
)
