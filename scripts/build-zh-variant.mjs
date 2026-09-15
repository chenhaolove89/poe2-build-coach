/**
 * Build packages/data/zh-variant.json: the Simplified -> Traditional table the
 * 简体/繁体 display switch uses.
 *
 * Source is OpenCC's STCharacters (one simplified char -> its traditional
 * form) and STPhrases (whole-word overrides). OpenCC's char table resolves
 * ambiguous characters by frequency — 制 stays 制, 升 stays 升 — and expects
 * the phrase table to disambiguate the cases that matter (升華 -> 昇華). That
 * makes the phrase table the part that decides whether the output reads as
 * real Traditional or as a machine transliteration, so it is worth shipping.
 *
 * It is also 1 MB unfiltered, which is too much to bundle for a handful of
 * game terms. So the phrase table is filtered against the text this app can
 * actually display: the data packs, plus the Chinese literals in the app's own
 * source. Anything outside that corpus would never be rendered anyway.
 *
 * Usage: node scripts/build-zh-variant.mjs [--write]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'packages/data/zh-variant.json')
const CACHE = resolve(ROOT, '.tmp/opencc')

const BASE = 'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary'
const SOURCES = ['STCharacters.txt', 'STPhrases.txt', 'TSCharacters.txt', 'TSPhrases.txt']

/** Longest phrase we index; a longer match just falls back to char mapping. */
const MAX_PHRASE = 12

async function dictionary(name) {
  const cached = join(CACHE, name)
  if (existsSync(cached)) return readFileSync(cached, 'utf-8')
  const res = await fetch(`${BASE}/${name}`, { headers: { 'user-agent': 'poe2-build-coach data pipeline' } })
  if (!res.ok) throw new Error(`${name} -> HTTP ${res.status}`)
  const text = await res.text()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(cached, text)
  return text
}

/** OpenCC rows are "key<TAB>value[ value...]"; the first value is the default. */
function rows(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.includes('\t')) continue
    const [key, values] = line.split('\t')
    out.push([key.trim(), values.trim().split(/\s+/)[0]])
  }
  return out
}

/**
 * Longest-phrase-first rewrite, falling back to the character table. Keep this
 * in sync with packages/core/src/i18n/variant.ts — a test pins them together.
 */
export function convert(text, { chars, phrases }) {
  const lengths = [...new Set(Object.keys(phrases).map((p) => p.length))].sort((a, b) => b - a)
  let out = ''
  let i = 0
  while (i < text.length) {
    let hit = null
    for (const len of lengths) {
      if (len > text.length - i) continue
      const candidate = text.slice(i, i + len)
      if (phrases[candidate]) {
        hit = candidate
        break
      }
    }
    if (hit) {
      out += phrases[hit]
      i += hit.length
      continue
    }
    out += chars[text[i]] ?? text[i]
    i++
  }
  return out
}

/**
 * Every Chinese string the UI can render: the data packs we display plus the
 * literals hard-coded in the app and core sources.
 */
function corpus() {
  const files = [
    'packages/data/name-zh.json',
    'packages/data/maps.json',
    'packages/data/stat-translations.json',
    'packages/data/mod-translations.json',
    'packages/data/affix-priorities.json',
    'packages/data/trade-stats.json',
    'packages/data/trade-stats.cn.json',
    'packages/data/trade-stats.tw.json',
    'packages/data/trade-currency.json',
    'packages/data/trade-currency.cn.json',
    'packages/data/trade-currency.tw.json',
  ]
  const chunks = []
  for (const file of files) {
    const path = resolve(ROOT, file)
    if (existsSync(path)) chunks.push(readFileSync(path, 'utf-8'))
  }

  const sources = [
    ...sourceFiles('apps/desktop/src'),
    ...sourceFiles('packages/core/src'),
  ]
  for (const file of sources) chunks.push(readFileSync(file, 'utf-8'))

  return chunks.join('\n')
}

function sourceFiles(dir) {
  const abs = resolve(ROOT, dir)
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(vue|ts)$/.test(entry.name)) out.push(full)
    }
  }
  if (existsSync(abs)) walk(abs)
  return out
}

async function main() {
  const chars = {}
  for (const [key, value] of rows(await dictionary(SOURCES[0]))) {
    if (key !== value && key.length === 1) chars[key] = value
  }

  const text = corpus()
  const phrases = {}
  let considered = 0
  for (const [key, value] of rows(await dictionary(SOURCES[1]))) {
    if (key === value || key.length < 2 || key.length > MAX_PHRASE) continue
    if (!/[\u4e00-\u9fff]/.test(key)) continue
    considered++
    if (text.includes(key)) phrases[key] = value
  }

  /**
   * The reverse direction feeds a realm whose client is Traditional (台服) into
   * a reader who wants Simplified. Its phrase table is filtered against the
   * traditional form of the same corpus — the corpus itself is written in
   * Simplified, so a traditional key would never match it directly.
   */
  const revChars = {}
  for (const [key, value] of rows(await dictionary(SOURCES[2]))) {
    if (key !== value && key.length === 1) revChars[key] = value
  }

  const traditional = convert(text, { chars, phrases })
  const revPhrases = {}
  let revConsidered = 0
  for (const [key, value] of rows(await dictionary(SOURCES[3]))) {
    if (key === value || key.length < 2 || key.length > MAX_PHRASE) continue
    if (!/[\u4e00-\u9fff]/.test(key)) continue
    revConsidered++
    if (traditional.includes(key)) revPhrases[key] = value
  }

  const pack = {
    source: "OpenCC ST/TSCharacters + ST/TSPhrases (Apache-2.0), phrase tables filtered to this app's vocabulary",
    toHant: { chars, phrases },
    toHans: { chars: revChars, phrases: revPhrases },
  }
  const bytes = JSON.stringify(pack).length

  console.log(
    `simplified -> traditional: ${Object.keys(chars).length} chars, ${Object.keys(phrases).length} phrases (${considered} considered)`,
  )
  console.log(
    `traditional -> simplified: ${Object.keys(revChars).length} chars, ${Object.keys(revPhrases).length} phrases (${revConsidered} considered)`,
  )
  console.log(`output:       ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`)

  if (process.argv.includes('--write')) {
    writeFileSync(OUT, JSON.stringify(pack))
    console.log('written')
  } else {
    console.log('(dry run — pass --write to update)')
  }
}

// Guarded so tests can import `convert` without rebuilding the dictionary.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
