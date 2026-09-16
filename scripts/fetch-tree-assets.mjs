/**
 * Build packages/data/tree-art/ from Grinding Gear Games' own passive-tree
 * export (github.com/grindinggear/poe2-skilltree-export).
 *
 * GGG publishes the tree data and its texture atlases for exactly this purpose.
 * Their developer docs say in-game data is otherwise not provided, with the
 * passive trees as the stated exception, so this is a first-party source rather
 * than a scraped mirror. The art itself is (c) Grinding Gear Games and is
 * redistributed under their third-party policy for non-commercial fan tools —
 * see the attribution note in README.
 *
 * Everything the renderer needs is resolved here, so the app never rebuilds
 * atlas keys at runtime:
 *
 *   nodes    our tree.json's exact icon string -> per-node-kind atlas rect
 *   frames   semantic name (keystoneAllocated, ...) -> rect
 *   lines    semantic name (orbit3Normal, ...) -> rect
 *   draw     the size to draw each node kind at, in tree coordinates
 *   geometry absolute node coordinates and the official edge list
 *
 * `draw` matters because the atlases are stored at half size (meta.scale 0.5),
 * so the size the tree's own coordinates expect is the atlas rect over that
 * scale. Deriving it here keeps the renderer free of magic numbers.
 *
 * Usage: node scripts/fetch-tree-assets.mjs [--write]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'packages/data/tree-art')
const CACHE = resolve(ROOT, '.tmp/ggg-tree')
const TREE_JSON = resolve(ROOT, 'packages/data/trees/0_5/tree.json')

const REPO = 'https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/main'
const UA = 'poe2-build-coach/0.4 (data pipeline; contact via github.com/chenhaolove89)'

/** Atlas sheets we ship. The disabled variants carry the unallocated node art. */
const ATLASES = ['skills', 'skills-disabled', 'frame', 'line', 'group-background', 'mastery-effect-active']

/** Icon section per node kind, as the atlas keys spell it. */
const ICON_SECTIONS = {
  normal: ['normalActive', 'normalInactive'],
  notable: ['notableActive', 'notableInactive'],
  keystone: ['keystoneActive', 'keystoneInactive'],
}

/**
 * Frame art per node kind and state. Normal nodes reuse the plain skill frame;
 * ascendancy nodes get their own so the two trees stay visually distinct.
 *
 * `backing` is the plate an ascendancy node sits on, drawn under its frame —
 * the atlas calls it Backing and it is what gives those nodes their inset look.
 * `start` is the ascendancy tree's own entry node.
 */
const FRAMES = {
  normal: { unallocated: 'PSSkillFrame', canAllocate: 'PSSkillFrameHighlighted', allocated: 'PSSkillFrameActive' },
  notable: {
    unallocated: 'NotableFrameUnallocated',
    canAllocate: 'NotableFrameCanAllocate',
    allocated: 'NotableFrameAllocated',
  },
  keystone: {
    unallocated: 'KeystoneFrameUnallocated',
    canAllocate: 'KeystoneFrameCanAllocate',
    allocated: 'KeystoneFrameAllocated',
  },
  ascendancyNormal: {
    backing: 'AscendancyFrameNormalBacking',
    unallocated: 'AscendancyFrameNormalUnallocated',
    canAllocate: 'AscendancyFrameNormalCanAllocate',
    allocated: 'AscendancyFrameNormalAllocated',
  },
  ascendancyNotable: {
    backing: 'AscendancyFrameNotableBacking',
    unallocated: 'AscendancyFrameNotableUnallocated',
    canAllocate: 'AscendancyFrameNotableCanAllocate',
    allocated: 'AscendancyFrameNotableAllocated',
  },
  ascendancyStart: {
    unallocated: 'AscendancyStartNode',
    canAllocate: 'AscendancyStartNode',
    allocated: 'AscendancyStartNode',
  },
}

/**
 * Mastery nodes carry no entry in the skills atlas — their icon paths are
 * placeholders — and are keyed instead by the node's `activeEffectImage`, with
 * `.png` appended. The atlas ships a lit and an unlit set; only the lit one is
 * packaged, so an unallocated mastery is drawn from it at reduced opacity.
 */
const MASTERY_PREFIX = 'masteryEffectActive:'

/** The disc a relocated ascendancy cluster sits on, plus its unlit variant. */
const GROUP_BACKGROUNDS = { circleActive: 'startNode:MainCircleActive', circle: 'startNode:MainCircle' }

async function cached(path, url, binary = false) {
  const file = resolve(CACHE, path)
  if (existsSync(file)) return binary ? readFileSync(file) : readFileSync(file, 'utf-8')
  const res = await fetch(`${REPO}/${url}`, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, body)
  return body
}

/** TexturePacker-style atlas: frame rectangles are already in image pixels. */
function rect(frame) {
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h }
}

const tree = JSON.parse(readFileSync(TREE_JSON, 'utf-8'))

// ------------------------------------------------------------------ atlases

const sheets = {}
for (const name of ATLASES) {
  const json = JSON.parse(await cached(`assets/${name}.json`, `assets/${name}.json`))
  const webp = await cached(`assets/${name}.webp`, `assets/${name}.webp`, true)
  const scale = Number(json.meta.scale) || 1
  sheets[name] = {
    json,
    webp,
    meta: { image: `${name}.webp`, scale, width: json.meta.size.w, height: json.meta.size.h },
  }
  console.log(`atlas ${name.padEnd(16)} ${json.meta.size.w}x${json.meta.size.h} @${scale}  ${Object.keys(json.frames).length} frames  ${(webp.length / 1024).toFixed(0)} KB`)
}

// ------------------------------------------------------------------ node icon rects

const skills = sheets.skills.json.frames
const skillsDisabled = sheets['skills-disabled'].json.frames

/**
 * Every icon path this tree can ask for, resolved once. A path may be present
 * under several sections (the same art serves a normal and a notable variant),
 * so each kind records the section that actually matched.
 */
const nodes = {}
const kindOfIcon = { normal: 0, notable: 0, keystone: 0 }
const counts = { normal: 0, notable: 0, keystone: 0, miss: 0 }
const misses = new Set()

for (const node of Object.values(tree.nodes)) {
  if (!node.icon) continue
  const kind = node.isKeystone ? 'keystone' : node.isNotable ? 'notable' : 'normal'
  counts[kind]++
  if (nodes[node.icon]) continue

  const png = node.icon.replace(/\.dds$/i, '.png')
  const entry = {}
  for (const [key, [on, off]] of Object.entries(ICON_SECTIONS)) {
    const a = skills[`${on}:${png}`]
    const b = skillsDisabled[`${off}:${png}`]
    if (a || b) entry[key] = { allocated: a ? rect(a.frame) : null, unallocated: b ? rect(b.frame) : null }
  }
  if (Object.keys(entry).length === 0) {
    misses.add(node.icon)
    continue
  }
  nodes[node.icon] = entry
  kindOfIcon[kind]++
}

// ------------------------------------------------------------------ frames and lines

const frameAtlas = sheets.frame.json.frames
const frames = {}
const missingFrames = []
for (const [kind, states] of Object.entries(FRAMES)) {
  for (const [state, key] of Object.entries(states)) {
    const hit = frameAtlas[`frame:${key}`]
    if (hit) frames[`${kind}.${state}`] = rect(hit.frame)
    else missingFrames.push(key)
  }
}
if (frameAtlas['frame:AscendancyStartNode']) {
  frames['ascendancyStart.unallocated'] = rect(frameAtlas['frame:AscendancyStartNode'].frame)
  frames['ascendancyStart.allocated'] = rect(frameAtlas['frame:AscendancyStartNode'].frame)
  frames['ascendancyStart.canAllocate'] = rect(frameAtlas['frame:AscendancyStartNode'].frame)
}

const lineAtlas = sheets.line.json.frames
const lines = {}
for (const [key, value] of Object.entries(lineAtlas)) {
  lines[key.replace(/^line:/, '')] = rect(value.frame)
}

/**
 * The disc the relocate-into-the-middle ascendancy cluster sits on. The atlas
 * holds it at 4000 units across, which is wider than the main tree's empty
 * centre, so the renderer scales it to the hole rather than trusting the art's
 * own size.
 */
/**
 * activeEffectImage -> rect, for the nodes the skills atlas cannot serve. Built
 * from our own tree's values rather than the whole atlas, so the index stays
 * proportional to what this tree actually uses (56 of 56 here).
 */
const masteryFrames = sheets['mastery-effect-active'].json.frames
const masteries = {}
const masteryValues = new Set()
for (const node of Object.values(tree.nodes)) {
  if (!node.icon || nodes[node.icon]) continue
  if (node.activeEffectImage) masteryValues.add(node.activeEffectImage)
}
const unmatchedMasteries = []
for (const value of masteryValues) {
  const hit = masteryFrames[`${MASTERY_PREFIX}${value}.png`]
  if (hit) masteries[value] = rect(hit.frame)
  else unmatchedMasteries.push(value)
}

const groupAtlas = sheets['group-background'].json.frames
const groups = {}
const missingGroups = []
for (const [key, atlasKey] of Object.entries(GROUP_BACKGROUNDS)) {
  const hit = groupAtlas[atlasKey]
  if (hit) groups[key] = rect(hit.frame)
  else missingGroups.push(atlasKey)
}

// ------------------------------------------------------------------ draw sizes

/**
 * The size a node kind occupies in the tree's own coordinates. The atlases are
 * stored at `meta.scale` of the original art, and those coordinates are in the
 * original art's space, so dividing back out gives the right on-tree size.
 */
const draw = {}
for (const [kind, entry] of Object.entries(ICON_SECTIONS)) {
  const sample = Object.values(nodes).find((e) => e[kind])
  const r = sample?.[kind]?.allocated ?? sample?.[kind]?.unallocated ?? null
  if (r) draw[kind] = Math.round(r.w / sheets.skills.meta.scale)
}

/** Frame art is drawn slightly larger than the icon it wraps. */
const drawFrame = {}
for (const [key, r] of Object.entries(frames)) {
  drawFrame[key] = Math.round(r.w / sheets.frame.meta.scale)
}

// ------------------------------------------------------------------ geometry

const official = JSON.parse(await cached('data.json', 'data.json'))
const positions = {}
for (const [id, node] of Object.entries(official.nodes)) {
  if (typeof node.x === 'number' && typeof node.y === 'number') positions[id] = [node.x, node.y]
}
const officialEdges = (official.edges ?? []).map((e) =>
  Array.isArray(e) ? e.map(String) : [String(e[0] ?? e.from), String(e[1] ?? e.to)],
)
/**
 * Group centres, which the ring art is drawn around.
 *
 * Orbit rings are concentric about their group, and the arc tiles are placed
 * relative to that point, so the centre has to come from the official data —
 * node positions alone do not identify it.
 */
const groupCentres = {}
for (const [id, group] of Object.entries(official.groups ?? {})) {
  if (typeof group.x === 'number' && typeof group.y === 'number') groupCentres[id] = [group.x, group.y]
}

const missingPositions = Object.keys(tree.nodes).filter((id) => !positions[id]).length

// ------------------------------------------------------------------ diagnostics

console.log('\nnodes by kind:', JSON.stringify(counts))
console.log(`distinct icons mapped: ${Object.keys(nodes).length} (missed ${misses.size})`)
if (misses.size) console.log('  unmapped examples:', [...misses].slice(0, 4).join(', '))
console.log(`frames: ${Object.keys(frames).length} mapped${missingFrames.length ? `, missing ${missingFrames.join(', ')}` : ''}`)
console.log(
  `groups: ${Object.keys(groups).length} mapped${missingGroups.length ? `, missing ${missingGroups.join(', ')}` : ''}` +
    (groups.circle ? ` (disc ${groups.circle.w * 2} units across)` : ''),
)
console.log(`lines: ${Object.keys(lines).length} keys -> ${Object.keys(lines).slice(0, 6).join(', ')}...`)
console.log(
  `masteries: ${Object.keys(masteries).length}` +
    (unmatchedMasteries.length ? ` mapped, ${unmatchedMasteries.length} unmatched (${unmatchedMasteries[0]})` : ' mapped'),
)
console.log('draw sizes (tree units):', JSON.stringify(draw))
console.log('frame sizes (tree units):', JSON.stringify(drawFrame))
console.log(
  `geometry: ${Object.keys(positions).length} positions, ${officialEdges.length} official edges, ${Object.keys(groupCentres).length} group centres`,
)
console.log(`  our tree nodes without an official position: ${missingPositions}`)

// A sanity figure for the draw sizes: same-orbit neighbours should be roughly
// one node apart, so an icon much larger than this would overlap its siblings.
// The ring has to be sorted by angle first — consecutive array entries are
// unrelated, and pairing those measures the ring's diameter, not its spacing.
{
  const byGroup = new Map()
  for (const n of Object.values(official.nodes)) {
    if (!byGroup.has(n.group)) byGroup.set(n.group, [])
    byGroup.get(n.group).push(n)
  }
  const gaps = []
  for (const [gid, list] of byGroup) {
    const centre = official.groups[gid]
    if (!centre) continue
    const byOrbit = new Map()
    for (const n of list) {
      if (!byOrbit.has(n.orbit)) byOrbit.set(n.orbit, [])
      byOrbit.get(n.orbit).push(n)
    }
    for (const ring of byOrbit.values()) {
      if (ring.length < 3 || ring.length > 40) continue
      const sorted = [...ring].sort(
        (a, b) => Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x),
      )
      for (let i = 1; i < sorted.length; i++) {
        gaps.push(Math.hypot(sorted[i].x - sorted[i - 1].x, sorted[i].y - sorted[i - 1].y))
      }
    }
  }
  gaps.sort((a, b) => a - b)
  if (gaps.length) {
    const q = (p) => gaps[Math.floor(gaps.length * p)].toFixed(0)
    console.log(`  same-orbit neighbour spacing: p10=${q(0.1)} median=${q(0.5)} p90=${q(0.9)} (n=${gaps.length})`)
  }
}

const pack = {
  source: 'github.com/grindinggear/poe2-skilltree-export (official; art (c) Grinding Gear Games)',
  fetched: new Date().toISOString().slice(0, 10),
  atlases: Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.meta])),
  draw,
  drawFrame,
  frames,
  lines,
  groups,
  masteries,
  nodes,
}
const geometry = {
  source: pack.source,
  positions,
  edges: officialEdges,
  groups: groupCentres,
}

const indexBytes = JSON.stringify(pack).length
const geomBytes = JSON.stringify(geometry).length
const webpBytes = ATLASES.reduce((s, n) => s + sheets[n].webp.length, 0)
console.log(`\noutput: index.json ${(indexBytes / 1024).toFixed(0)} KB, geometry.json ${(geomBytes / 1024).toFixed(0)} KB, webp ${(webpBytes / 1024).toFixed(0)} KB`)
console.log(`     -> ${OUT_DIR}`)

if (process.argv.includes('--write')) {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const name of ATLASES) writeFileSync(resolve(OUT_DIR, `${name}.webp`), sheets[name].webp)
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(pack))
  writeFileSync(resolve(OUT_DIR, 'geometry.json'), JSON.stringify(geometry))
  console.log('written')
} else {
  console.log('(dry run — pass --write to update)')
}
