/**
 * Audit the area codes in a real client log against the map table.
 *
 * The farm page joins a run to `packages/data/maps.json` by the area code the client
 * writes in `Generating level 79 area "MapDeforestation"`. That code comes from the
 * game data (PoB2's WorldAreas.lua), so it is exact — but a patch can add a map the
 * data file predates, and then the run shows up in the app as an unknown code rather
 * than as a map. This script is how that gap gets found before a player does.
 *
 * It also pairs each code with the name the player's own client showed, which is the
 * one thing no data source has: the log is the only place 国服's own wording for a map
 * appears (the name dictionary renders `Deforestation` as 伐林地 while the client says
 * 毁坏的林场).
 *
 * Usage: node scripts/verify-map-codes.mjs <path-to-Client.txt> [more paths...]
 *
 * Exits 1 when the log names an area code the table does not carry, because that is
 * the actionable outcome; an endgame-free log (nothing resolved, nothing unresolved)
 * exits 0 and says so.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const table = JSON.parse(readFileSync(path.join(root, 'packages/data/maps.json'), 'utf8'))
const byCode = new Map(table.areas.filter((a) => a.code).map((a) => [a.code, a]))

const GENERATING = /Generating level (\d+) area "([^"]+)"/
const SCENE = /\[SCENE\] Set Source \[(.+?)\]/
/** Screen states, not areas: the loader and the main menu. */
const NOT_AN_AREA = new Set(['(null)', '(unknown)'])

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node scripts/verify-map-codes.mjs <path-to-Client.txt> [more paths...]')
  process.exit(2)
}

/** code -> { levels:Set, clientNames:Set, count } */
const seen = new Map()
for (const file of files) {
  let pending = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const gen = GENERATING.exec(line)
    if (gen) {
      const code = gen[2]
      if (!seen.has(code)) seen.set(code, { levels: new Set(), clientNames: new Set(), count: 0 })
      const rec = seen.get(code)
      rec.levels.add(Number(gen[1]))
      rec.count++
      pending = rec
      continue
    }
    if (!pending) continue
    // The scene line follows the generating line, with a (null) in between.
    const scene = SCENE.exec(line)
    if (!scene) continue
    const name = scene[1].trim()
    if (NOT_AN_AREA.has(name)) continue
    pending.clientNames.add(name)
    pending = null
  }
}

if (seen.size === 0) {
  console.log('日志里没有任何 `Generating level … area …` 行 —— 不是终局会话，或路径不对。')
  process.exit(0)
}

const resolved = []
const gaps = []
const notAMap = []
for (const [code, rec] of seen) {
  const area = byCode.get(code)
  if (area) resolved.push({ code, rec, area })
  // A `Map*` code names an atlas map instance, so one missing from the table is a real
  // gap. `HideoutShoreline`, `Abyss_Pinnacle` and friends are where the player *is*
  // rather than what they rolled, and the atlas table is not supposed to carry them.
  else if (/^Map/.test(code)) gaps.push({ code, rec })
  else notAMap.push({ code, rec })
}

console.log(`日志里出现 ${seen.size} 个区域码。\n`)
console.log(`已在地图表中（${resolved.length}）：`)
for (const { code, rec, area } of resolved.sort((a, b) => a.code.localeCompare(b.code))) {
  const names = [...rec.clientNames].join(' / ') || '(无中文名)'
  const lv = [...rec.levels].sort((a, b) => a - b).join('/')
  console.log(`  ✓ ${code} → ${area.name} [${area.kind}] lv${lv} ×${rec.count}  客户端名：${names}`)
}

if (notAMap.length) {
  console.log(`\n非地图区域（${notAMap.length}，藏身处/竞技场/城镇，本就不在地图表里）：`)
  for (const { code, rec } of notAMap.sort((a, b) => a.code.localeCompare(b.code))) {
    const names = [...rec.clientNames].join(' / ') || '(无中文名)'
    console.log(`  · ${code} ×${rec.count}  客户端名：${names}`)
  }
}

if (gaps.length === 0) {
  console.log('\n没有表外的地图区域码 —— 地图表覆盖了这份日志里的每一次刷图。')
  process.exit(0)
}

console.log(`\n⚠ 地图表里没有的地图区域码（${gaps.length}）—— 这些刷图在应用里会显示为未知：`)
for (const { code, rec } of gaps.sort((a, b) => a.code.localeCompare(b.code))) {
  const names = [...rec.clientNames].join(' / ') || '(无中文名)'
  const lv = [...rec.levels].sort((a, b) => a - b).join('/')
  console.log(`  ✗ ${code} lv${lv} ×${rec.count}  客户端名：${names}`)
}
console.log('\n处理：跑 `node scripts/build-maps.mjs --refresh` 重取游戏数据；若仍未收录，说明该图晚于上游数据。')
process.exit(1)
