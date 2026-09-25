// Build packages/data/atlas.json from the public PoE2 data export.
//
//   https://repoe-fork.github.io/poe2/passive_skill_trees/Atlas.json
//
// RePoE fork's PoE2 export is the same category of source the project already
// relies on (PoB2's tree data, GGG's skill-tree export): a public datamined dump,
// not the game's own files. GGG publishes no atlas-tree export of its own --
// grindinggear/atlastree-export is PoE1 (it contains Maven and the Searing Exarch
// and none of the 0.5 atlas nodes) -- so this is the only faithful source for the
// atlas tree's shape. poe2wiki carries the same node names and effects through its
// Cargo table but no geometry at all.
//
// The tree stores no explicit coordinates: a node sits on its group at (x, y),
// offset by the orbit radius at its slot's angle. The formula below is the game's
// own convention -- sin for x, -cos for y, so slot 0 points up and slots run
// clockwise -- and it is baked in here so the renderer only reads positions.
//
// Usage: node scripts/build-atlas.mjs [--refresh]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.tmp', 'atlas-src')
const OUT = join(ROOT, 'packages', 'data', 'atlas.json')
const REFRESH = process.argv.includes('--refresh')

const BASE = 'https://repoe-fork.github.io/poe2/'
const SOURCE_PATH = 'passive_skill_trees/Atlas.json'

async function cached(name, url) {
  const file = join(CACHE, name)
  if (existsSync(file) && !REFRESH) return readFileSync(file, 'utf8')
  mkdirSync(CACHE, { recursive: true })
  process.stderr.write(`fetching ${url}\n`)
  const res = await fetch(url, { headers: { 'User-Agent': 'poe2-build-coach/scripts' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  const text = await res.text()
  JSON.parse(text) // validate before overwriting anything
  writeFileSync(file, text)
  return text
}

const TWO_PI = Math.PI * 2

// The side trees, in the order the UI lists them. `main` is the generic tree; the
// rest are the mechanic trees, which is what makes this page strategy-relevant: a
// node's subtree is the mechanic it improves.
const SUBTREE_LABEL = {
  main: '主树',
  Breach: '裂隙',
  Delirium: '迷雾',
  Ritual: '祭祀',
  Expedition: '探险',
  Abyss: '深渊',
  Incursion: '神庙',
}
/** Distinct hue per subtree, so the tree reads at a glance. */
const SUBTREE_COLOR = {
  main: '#8a93ad',
  Breach: '#c96fd0',
  Delirium: '#7aa5d9',
  Ritual: '#e0885a',
  Expedition: '#d9a441',
  Abyss: '#6fa8dc',
  Incursion: '#7dd087',
}

const raw = JSON.parse(await cached('Atlas.json', BASE + SOURCE_PATH))
const { groups, passives, roots, orbit_radii: orbitRadii, skills_per_orbit: skillsPerOrbit } = raw

const rootSet = new Set(roots.map(Number))

/** The node's kind. `mastery` is the icon-only slot the atlas tree also uses. */
function kindOf(p) {
  if (p.is_atlas_root) return 'root'
  if (p.is_icon_only) return 'mastery'
  if (p.is_keystone) return 'keystone'
  if (p.is_notable) return 'notable'
  return 'normal'
}

// Position: group centre, offset along the orbit. Group-passives carry the orbit
// as an index into orbitRadii and the slot as `position_clockwise`.
function positionOf(group, slot) {
  const orbit = slot.radius ?? 0
  const per = skillsPerOrbit[orbit] ?? 1
  const angle = (TWO_PI * (slot.position_clockwise ?? 0)) / (per || 1)
  const r = orbitRadii[orbit] ?? 0
  return {
    x: +(group.x + r * Math.sin(angle)).toFixed(2),
    y: +(group.y - r * Math.cos(angle)).toFixed(2),
  }
}

const nodes = []
const seenHash = new Set()
const duplicates = []
let groupIndex = 0
/** The biome a node's effect names, written as [Biome|Mountain] in the source. */
const BIOME_KEYWORD = /\[Biome\|([^\]]+)\]/g
for (const group of groups) {
  for (const slot of group.passives) {
    const p = passives[String(slot.hash)]
    if (!p) continue
    // One passive in the export is listed by two groups ("Dark Bloodlines"). The
    // table is keyed by hash, so the second placement would render a phantom twin;
    // keep the first and report it rather than letting it double-draw.
    if (seenHash.has(slot.hash)) {
      duplicates.push(`${p.name} (${slot.hash})`)
      continue
    }
    seenHash.add(slot.hash)
    const pos = positionOf(group, slot)
    const stats = p.stat_text ?? []
    // "City" and "Cities" are different sentences in the game ("City Areas have..."
    // versus "Faridun Cities are also considered...") but the same answer to the
    // question the filter asks — which nodes help my city maps — so they fold into
    // one keyword here. The original wording stays visible in the effect text.
    const biomes = [
      ...new Set(
        [...stats.join(' ').matchAll(BIOME_KEYWORD)].map((m) => (m[1] === 'Cities' ? 'City' : m[1])),
      ),
    ]
    nodes.push({
      hash: slot.hash,
      id: p.id,
      name: p.name || '',
      kind: kindOf(p),
      /**
       * The game's own icon path for this node (e.g.
       * Art/2DArt/SkillIcons/passives/AtlasTrees/ExpeditionNotable5.dds). Every
       * node in the export carries one, but no complete converted icon set is
       * publicly available yet (repoe-fork's Art dump has converted exactly one),
       * so the renderer still self-draws; this field is kept so an icon pack --
       * extracted from a client, or a completed upstream conversion -- can be
       * dropped in and lit up without touching the data pipeline again.
       */
      icon: p.icon ?? null,
      subtree: p.atlas_subtree?.id ?? 'main',
      /** Raw effect text; core's atlasStatText strips the [Id|Label] markup. */
      stats,
      /**
       * Biomes this node's effect is restricted to. This is the join back to the map
       * table: a node that says "in [Biome|Mountain] Areas" is what you take for the
       * Mountain maps you are farming, and it is the game's own wording, not a
       * mapping someone authored.
       */
      biomes,
      flavour: p.flavour_text || '',
      x: pos.x,
      y: pos.y,
      /** Kept so an edge can be drawn as an arc when both ends share them. */
      group: groupIndex,
      orbit: slot.radius ?? 0,
      orbitIndex: slot.position_clockwise ?? 0,
      connections: slot.connections ?? [],
      root: rootSet.has(slot.hash),
      // Parallel to `connections`: an orbit index whose sign picks the sweep
      // direction, or INT_MAX for a straight line. Consumed below, not emitted.
      splines: slot.splines ?? [],
    })
  }
  groupIndex++
}

const byHash = new Map(nodes.map((n) => [n.hash, n]))

// Edges, deduplicated: the game lists each connection from both ends.
//
// Most are drawn as arcs, because that is what makes a ring of nodes read as a ring.
// Two cases, matching how the tree is laid out: two nodes on the same ring curve
// along that ring centred on their group, and anything else uses the radius the
// export records for that connection (`splines`, parallel to `connections`) — a
// signed orbit index whose sign is the sweep direction, with INT_MAX meaning the
// game wants a straight line.
const STRAIGHT = 2147483647
const edgeKeys = new Set()
const edges = []
for (const node of nodes) {
  for (const [i, to] of node.connections.entries()) {
    const other = byHash.get(to)
    if (!other) continue
    const key = node.hash < to ? `${node.hash}-${to}` : `${to}-${node.hash}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)

    let arc = null
    if (node.group === other.group && node.orbit === other.orbit && node.orbit > 0) {
      const per = skillsPerOrbit[node.orbit] || 1
      const delta = (((other.orbitIndex - node.orbitIndex) % per) + per) % per
      arc = { r: orbitRadii[node.orbit], sweep: delta <= per / 2 ? 1 : 0 }
    } else {
      const spline = node.splines[i] ?? STRAIGHT
      if (spline !== 0 && Math.abs(spline) < orbitRadii.length) {
        arc = { r: orbitRadii[Math.abs(spline)], sweep: spline < 0 ? 1 : 0 }
      }
    }
    edges.push(arc ? [node.hash, to, arc.r, arc.sweep] : [node.hash, to])
  }
}

// `splines` was scaffolding for the edge pass; it does not belong in the data file.
for (const node of nodes) delete node.splines

const subtrees = []
for (const id of Object.keys(SUBTREE_LABEL)) {
  const members = nodes.filter((n) => n.subtree === id)
  if (members.length === 0) continue
  subtrees.push({
    id,
    label: SUBTREE_LABEL[id],
    color: SUBTREE_COLOR[id] ?? '#8a93ad',
    root: members.find((n) => n.root)?.hash ?? null,
    count: members.length,
    notables: members.filter((n) => n.kind === 'notable' || n.kind === 'keystone').length,
  })
}

// Bounds cover the node positions, not just the group centres: an orbit can push a
// node well outside its group's box, and clipping it would hide real nodes.
const xs = nodes.map((n) => n.x)
const ys = nodes.map((n) => n.y)
const pad = 260

const out = {
  source: `repoe-fork.github.io/poe2 ${SOURCE_PATH} (RePoE fork datamined export; GGG publishes no PoE2 atlas-tree export)`,
  captured: new Date().toISOString().slice(0, 10),
  bounds: {
    minX: Math.floor(Math.min(...xs) - pad),
    minY: Math.floor(Math.min(...ys) - pad),
    maxX: Math.ceil(Math.max(...xs) + pad),
    maxY: Math.ceil(Math.max(...ys) + pad),
  },
  /** Biome keywords the tree itself names, so the UI can offer them as filters. */
  biomeKeywords: [...new Set(nodes.flatMap((n) => n.biomes))].sort(),
  subtrees,
  nodes,
  edges,
}
writeFileSync(OUT, JSON.stringify(out))

const kinds = {}
for (const n of nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1
console.log(`wrote ${OUT}`)
console.log(`  nodes ${nodes.length} | edges ${edges.length} (${edges.filter((e) => e.length === 4).length} arc) | groups ${groups.length}`)
console.log(`  kinds: ${JSON.stringify(kinds)}`)
console.log(`  subtrees: ${subtrees.map((s) => `${s.id} ${s.count}`).join(' | ')}`)
console.log(`  bounds: ${JSON.stringify(out.bounds)}`)
console.log(`  biome keywords: ${out.biomeKeywords.join(' | ')}`)
console.log(`  nodes naming a biome: ${nodes.filter((n) => n.biomes.length).length}`)
if (duplicates.length) console.log(`  duplicate placements dropped (${duplicates.length}): ${duplicates.join(', ')}`)

// A root must exist per subtree, or the allocation planner has nowhere to start.
const missingRoot = subtrees.filter((s) => s.root == null)
if (missingRoot.length) console.log(`  WARNING: subtrees without a root: ${missingRoot.map((s) => s.id).join(', ')}`)

// Every edge endpoint must be a real node; a dangling id means the export and the
// group data disagree and the renderer would drop a link silently.
const badArc = edges.filter((e) => e.length === 4 && !(e[2] > 0))
if (badArc.length) console.log(`  WARNING: ${badArc.length} arcs with a non-positive radius`)
const dangling = edges.filter(([a, b]) => !byHash.has(a) || !byHash.has(b))
if (dangling.length) console.log(`  WARNING: ${dangling.length} dangling edges`)

// A node outside the bounds would be drawn off-canvas.
const outside = nodes.filter(
  (n) => n.x < out.bounds.minX || n.x > out.bounds.maxX || n.y < out.bounds.minY || n.y > out.bounds.maxY,
)
if (outside.length) console.log(`  WARNING: ${outside.length} nodes outside bounds`)
