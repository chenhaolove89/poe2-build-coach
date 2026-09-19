/**
 * Audit the campaign zone names against a real client log.
 *
 * The follower matches `[SCENE] Set Source` and `[LOADING SCREEN]` names
 * against the names in `packages/data/campaign.json`. Those names were
 * authored from guide sources, not from a client, so the one thing that can
 * silently break the feature is a spelling the client writes differently.
 * This script reads a Client.txt (any slice of one — crash-dump log copies
 * work too), lists the area names it observed, and reports for each campaign
 * zone whether the log ever named it.
 *
 * Usage: node scripts/verify-campaign-names.mjs <path-to-Client.txt> [more paths...]
 *
 * Exit is 0 either way; read the output. Zones with no observation are not
 * necessarily wrong — the log may simply not cover them (an endgame log never
 * names campaign zones) — but a NEAR-MISS line is a spelling to fix.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const campaign = JSON.parse(
  readFileSync(path.join(root, 'packages/data/campaign.json'), 'utf8'),
)

const SCENE = /\[SCENE\] Set Source \[(.+?)\]/
const LOADING = /\[LOADING SCREEN\] \((.+?)\) Duration/

const observed = new Map()
const counts = { scene: 0, loading: 0 }
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const scene = SCENE.exec(line)
    if (scene) {
      counts.scene++
      observed.set(scene[1].trim(), (observed.get(scene[1].trim()) ?? 0) + 1)
      continue
    }
    const loading = LOADING.exec(line)
    if (loading) {
      counts.loading++
      observed.set(loading[1].trim(), (observed.get(loading[1].trim()) ?? 0) + 1)
    }
  }
}

/** The forms a zone name is looked up under: as-is and after a `kind:` prefix. */
function forms(name) {
  const out = [name]
  const cut = Math.max(name.lastIndexOf('：'), name.lastIndexOf(':'))
  if (cut !== -1 && name.slice(cut + 1).trim()) out.push(name.slice(cut + 1).trim())
  return out
}

const seen = new Set()
for (const name of observed.keys()) for (const f of forms(name)) seen.add(f)

console.log(`观察到的区域名：${observed.size} 种（Set Source ×${counts.scene}，LOADING ×${counts.loading}）\n`)

let named = 0
for (const act of campaign.acts) {
  for (const zone of act.zones) {
    const candidates = [zone.zh, zone.en].filter(Boolean)
    const hit = candidates.find((n) => seen.has(n))
    if (hit) {
      named++
      console.log(`✓ ${act.id} ${zone.en} ← 日志写作「${hit}」`)
    }
  }
}
console.log(`\n74 个战役区域中，日志提到过 ${named} 个。`)

console.log('\n日志里出现过、但战役数据里没有的名字（应有地图/藏身处/异界等）：')
for (const [name, n] of [...observed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const campaignish = campaign.acts.some((a) => a.zones.some((z) => z.zh === name || z.en === name))
  if (!campaignish) console.log(`  ${name} ×${n}`)
}
