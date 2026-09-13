/**
 * Turn a raw POE2WAY atlas scrape into packages/data/map-topology.json.
 *
 * Input: .tmp/topo/batch-*.json, produced by opening each atlas row's
 * "topology" button in a browser and serialising the `svg.topology` elements
 * that the modal renders (POE2WAY lazily loads one chunk per map).
 *
 * The SVGs are sanitised here — tag/attribute whitelist, no ids, no namespace
 * declarations — so the app can inject them with v-html without trusting
 * remote markup at runtime.
 *
 * Usage: node scripts/build-map-topology.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, '.tmp/topo')
const OUT = resolve(ROOT, 'packages/data/map-topology.json')

const ALLOWED_TAGS = new Set(['line', 'circle', 'rect', 'path', 'polyline', 'polygon'])
const ALLOWED_ATTRS = new Set([
  'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height',
  'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
])

/** Rebuild one topology SVG from its whitelisted primitives. */
function sanitize(svgText) {
  const viewBox = svgText.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100'
  // Connections inherit their stroke from a <g> we drop, so re-apply it to lines.
  const groupStroke = svgText.match(/<g class="connections"[^>]*stroke="([^"]+)"/)?.[1] ?? '#4b5563'
  const groupStrokeWidth = svgText.match(/<g class="connections"[^>]*stroke-width="([^"]+)"/)?.[1] ?? '2'
  const parts = []
  const lines = []
  for (const element of svgText.matchAll(/<(line|circle|rect|path|polyline|polygon)\b([^>]*?)\/?>/g)) {
    const tag = element[1]
    if (!ALLOWED_TAGS.has(tag)) continue
    const attrs = []
    for (const attr of element[2].matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)) {
      if (!ALLOWED_ATTRS.has(attr[1])) continue
      attrs.push(`${attr[1]}="${attr[2]}"`)
    }
    if (attrs.length === 0) continue
    if (tag === 'line') {
      lines.push(`<line ${attrs.join(' ')}/>`)
      continue
    }
    parts.push(`<${tag} ${attrs.join(' ')}/>`)
  }
  const connections = lines.length
    ? `<g stroke="${groupStroke}" stroke-width="${groupStrokeWidth}" fill="none">${lines.join('')}</g>`
    : ''
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${connections}${parts.join('')}</svg>`
}

if (!existsSync(SRC)) {
  console.error('no scrape found at .tmp/topo — run the browser capture first')
  process.exit(1)
}

const rows = []
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.json'))) {
  const parsed = JSON.parse(readFileSync(resolve(SRC, file), 'utf8'))
  if (Array.isArray(parsed)) {
    for (const batch of parsed) rows.push(...batch.rows)
  } else if (parsed.svgs) {
    rows.push({ name: parsed.map, svgs: parsed.svgs })
  }
}

const maps = {}
let variants = 0
for (const row of rows) {
  if (!row.name || !Array.isArray(row.svgs) || row.svgs.length === 0) continue
  const cleaned = row.svgs.map(sanitize).filter((s) => s.length > 200)
  if (cleaned.length === 0) continue
  maps[row.name.toLowerCase()] = cleaned
  variants += cleaned.length
}

const pack = {
  source:
    'POE2WAY (poe2way.com/atlas) topology SVGs, scraped via the per-row topology button; ' +
    'simplified to whitelisted primitives, no ids or namespace declarations',
  captured: new Date().toISOString().slice(0, 10),
  maps,
}

writeFileSync(OUT, JSON.stringify(pack))
const bytes = JSON.stringify(pack).length
console.log(`maps with topology: ${Object.keys(maps).length}`)
console.log(`variants: ${variants}`)
console.log(`output: ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`)
