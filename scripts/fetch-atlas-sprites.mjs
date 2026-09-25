// Fetch the PoE2 atlas tree sprite sheets that Maxroll's planner publishes, and
// repackage them with their crop indexes for the atlas panel.
//
// Why this source: the public data export (repoe-fork) carries every node's icon
// PATH but converts almost none of the textures (one file), GGG publishes no
// atlas art at all, and the remaining sites with icons hide them in private
// pipelines. Maxroll's planner asset bundle -- the same datamined game art,
// already converted and indexed -- is the only complete, stable form available.
// The bundle is self-describing: six WebP sheets, each followed by a JSON index
// mapping game art paths to crop rects inside that sheet.
//
// Output (packages/data/atlas-art/):
//   sprite0..5.webp          the sheets, byte-identical to the source
//   index.json               {
//                              source, captured,
//                              sheets: [{file,width,height}],
//                              rects:  { artPathLowercase: [sheet, x, y, w, h] }
//                            } -- rect coords are sheet pixels; the rect scale
//                            baked in the bundle is already applied.
//
// Usage: node scripts/fetch-atlas-sprites.mjs [--offline]
//   --offline reads .tmp/atlas-src/atlas_passive_tree.bundle instead of the
//   network (the download is flaky from some networks; fetch it with curl).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'packages', 'data', 'atlas-art')
const LOCAL = join(ROOT, '.tmp', 'atlas-src', 'atlas_passive_tree.bundle')
const BUNDLE = 'https://assets-ng.maxroll.gg/poe2planner/game/atlas_passive_tree.bundle'
const OFFLINE = process.argv.includes('--offline')

mkdirSync(join(ROOT, '.tmp', 'atlas-src'), { recursive: true })
mkdirSync(OUT, { recursive: true })

let body
if (OFFLINE || existsSync(LOCAL)) {
  if (!existsSync(LOCAL)) throw new Error(`--offline but no cached bundle at ${LOCAL}`)
  body = readFileSync(LOCAL)
} else {
  const res = await fetch(BUNDLE, { headers: { 'User-Agent': 'poe2-build-coach/scripts' } })
  if (!res.ok) throw new Error(`${BUNDLE} -> HTTP ${res.status}`)
  body = new Uint8Array(await res.arrayBuffer())
  writeFileSync(LOCAL, body)
}

const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
const count = view.getUint32(0, true)
if (!(count >= 1 && count <= 32)) throw new Error(`unexpected bundle header: count=${count}`)

/** WebP dimensions: parse the VP8X / VP8 / VP8L chunk header (all common forms). */
function webpSize(bytes) {
  const fourcc = bytes.toString('latin1', 12, 16)
  if (fourcc === 'VP8X') {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  }
  if (fourcc === 'VP8 ') {
    return { width: 1 + bytes.readUIntLE(26, 2), height: 1 + bytes.readUIntLE(28, 2) }
  }
  if (fourcc === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  throw new Error(`unknown webp chunk ${fourcc}`)
}

const index = {}
const sheets = []
let cursor = 4
for (let i = 0; i < count; i++) {
  const size = view.getUint32(cursor, true)
  const indexSize = view.getUint32(cursor + 4, true)
  cursor += 8
  const webp = body.subarray(cursor, cursor + size)
  if (webp.toString('latin1', 0, 4) !== 'RIFF') throw new Error(`sheet ${i}: expected RIFF at cursor ${cursor}`)
  cursor += size
  const idx = JSON.parse(new TextDecoder().decode(body.subarray(cursor, cursor + indexSize)))
  cursor += indexSize
  const dims = webpSize(webp)
  sheets.push({ webp, ...dims })
  for (const [path, rect] of Object.entries(idx)) {
    // The rect is ALREADY in this sheet's pixels -- verified against known art
    // (a keystone frame is 109 px wide on the 512-wide sheet 0). The bundle's
    // `scale: 2` instead means the sheet is twice the game's coordinate density:
    // the on-canvas draw size is rect / scale. Multiplying the rect by scale
    // samples outside the sheet and yields garbage crops.
    const scale = rect.scale ?? 1
    index[path] = [i, rect.x, rect.y, rect.w, rect.h, scale]
  }
}

sheets.forEach(({ webp }, i) => writeFileSync(join(OUT, `sprite${i}.webp`), webp))
// Also emit named lookups for the frame/UI art the renderer composes nodes from:
// keystone/notable/passive-point frames (normal+active) and the subtree starting
// points. These are UIImages living on sheet 0 and 5.
const frames = {}
for (const [path, r] of Object.entries(index)) {
  if (path.includes('atlasscreen/atlaspassiveskillscreen') || path.includes('atlasscreen/startingpoint')) {
    const name = path.split('/').pop().replace(/^atlaspassiveskillscreen/, '')
    frames[name] = r
  }
}
writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify(
    {
      source: 'Maxroll poe2planner atlas_passive_tree.bundle (datamined game art, (c) GGG)',
      captured: new Date().toISOString().slice(0, 10),
      sheets: sheets.map(({ webp, width, height }, i) => ({
        file: `sprite${i}.webp`,
        width,
        height,
      })),
      rects: index,
      frames,
    },
    null,
    1,
  ),
)
console.log(`wrote ${sheets.length} sheets and ${Object.keys(index).length} rects to ${OUT}`)

// icons.ts: per-node icon URLs/rects plus the frame art the panel composes
// nodes from, as static imports the bundler can fingerprint.
const iconBase = (p) => p.split('/').pop().replace(/\.dds$/i, '')
const iconKeys = Object.keys(index).filter((k) => k.includes('skillicons/passives'))
const lines = []
lines.push('// Generated by scripts/fetch-atlas-sprites.mjs -- do not edit.')
lines.push('// PoE2 atlas node icons and frame art, cropped from the Maxroll planner sprite')
lines.push('// bundle (datamined game art, (c) GGG). Keys are lowercase art basenames.')
for (const k of iconKeys) {
  const id = iconBase(k).replace(/-/g, '_')
  lines.push(`import _i_${id} from './icons/${iconBase(k)}.webp'`)
}
for (let i = 0; i < sheets.length; i++) lines.push(`import _s${i} from './sprite${i}.webp'`)
lines.push('')
lines.push('export const ICON_URLS: Record<string, string> = {')
for (const k of iconKeys) {
  const id = iconBase(k).replace(/-/g, '_')
  lines.push(`  ${id}: _i_${id},`)
}
lines.push('}')
lines.push('')
lines.push('/** base -> [sheet, x, y, w, h, scale]: sheet-pixel crop; draw size is px / scale. */')
lines.push('export const ICON_RECTS: Record<string, [number, number, number, number, number, number]> = {')
for (const k of iconKeys) {
  const id = iconBase(k).replace(/-/g, '_')
  lines.push(`  ${id}: [${index[k].join(', ')}],`)
}
lines.push('}')
lines.push('')
lines.push('export const SPRITES: Record<number, string> = {')
for (let i = 0; i < sheets.length; i++) lines.push(`  ${i}: _s${i},`)
lines.push('}')
lines.push('')
lines.push('export const SHEET_SIZES: Record<number, [number, number]> = {')
for (let i = 0; i < sheets.length; i++) lines.push(`  ${i}: [${sheets[i].width}, ${sheets[i].height}],`)
lines.push('}')
lines.push('')
lines.push('/** frame/starting-point name -> [sheet, x, y, w, h, scale]. */')
lines.push('export const FRAMES: Record<string, [number, number, number, number, number, number]> = {')
for (const [name, r] of Object.entries(frames)) lines.push(`  ${name}: [${r.join(', ')}],`)
lines.push('}')
writeFileSync(join(OUT, 'icons.ts'), lines.join('\n') + '\n')
