/**
 * The farming strategy an Atlas plan implies, derived rather than authored.
 *
 * A share code carries the whole allocation, and the allocation *is* the strategy:
 * how far each mechanic subtree is taken says what the player farms, the biome
 * keywords on the allocated nodes say which maps those effects land on, and the
 * map table turns a biome into concrete candidate maps. Deriving the brief from
 * that data keeps it honest in a way written guides cannot be — there is no
 * income figure to invent and no tier list to go stale, only the two data files
 * that get re-baked with every patch.
 *
 * Two honesty rules the shape enforces:
 *
 *   - The brief describes what the plan says, not what the sharer meant. The code
 *     carries no favourite maps and no notes, so the biome's map list is presented
 *     as candidates ranked by the community's navigation rating, never as "the
 *     maps the sharer runs".
 *   - Weak evidence stays quiet. A single biome node is a rider, not a strategy,
 *     so a biome only appears once at least two allocated nodes are restricted to
 *     it; a mechanic with nothing allocated does not appear at all.
 */
import type { MapArea } from '../maps/areas.js'
import { atlasBiomeKey, isAllocatable, type AtlasIndex, type AtlasTree } from './tree.js'

export interface StrategyMechanic {
  id: string
  label: string
  color: string
  allocated: number
  total: number
  notablesTaken: number
  notablesTotal: number
}

export interface StrategyArea {
  name: string
  navigation: number | null
}

export interface StrategyBiome {
  /** The tree's own keyword ("Mountain", "City"), as the node effects name it. */
  keyword: string
  /** Allocated nodes whose effect is restricted to this biome. */
  nodes: number
  /** Candidate maps for this biome, best-rated first. */
  areas: StrategyArea[]
}

export interface StrategyKeystone {
  name: string
  /** Subtree id the keystone sits on, for colouring. */
  subtree: string
  color: string
}

export interface StrategyBrief {
  allocatedCount: number
  /** Mechanic subtrees with something allocated, strongest first. Never `main`. */
  mechanics: StrategyMechanic[]
  /** The generic main tree, or null when nothing on it is allocated. */
  main: StrategyMechanic | null
  /** Targeted biomes, most-allocated first. */
  biomes: StrategyBiome[]
  keystones: StrategyKeystone[]
}

export interface StrategyOptions {
  /** Allocated nodes restricted to a biome before that biome counts as targeted. */
  biomeThreshold?: number
  /** Candidate maps kept per biome. */
  topAreas?: number
}

/**
 * Whether a map-table area can roll into the tree's biome keyword.
 *
 * The fold is the one `atlasBiomeKey` makes (three table cities -> one tree
 * keyword), except for "Non-City", which the tree writes as a bucket: an effect
 * "in Non-City Areas" lands on every map that is not a city map, so the join is
 * the complement rather than a name match.
 */
function areaInBiome(area: MapArea, keyword: string): boolean {
  const keys = area.biomes.map(atlasBiomeKey)
  if (keyword === 'Non-City') return keys.length > 0 && keys.every((k) => k !== 'City')
  return keys.includes(keyword)
}

/**
 * Derive the brief from an allocation.
 *
 * Mechanics are ranked by notables taken rather than raw points: the main tree's
 * filler inflates raw counts, while notables are what a farming plan is built out
 * of. Ties fall back to points, then to the tree's own subtree order, so the same
 * plan always derives the same brief — the text card a sharer copies and the card
 * a recipient's app regenerates must not drift.
 */
export function strategyBrief(
  tree: AtlasTree,
  index: AtlasIndex,
  allocated: ReadonlySet<number>,
  areas: readonly MapArea[],
  options: StrategyOptions = {},
): StrategyBrief {
  const biomeThreshold = options.biomeThreshold ?? 2
  const topAreas = options.topAreas ?? 5

  // Per-subtree allocation, straight from the same source the atlas page shows.
  const bySubtree = new Map<string, StrategyMechanic>()
  for (const hash of allocated) {
    const node = index.byHash.get(hash)
    if (!node) continue
    const entry = bySubtree.get(node.subtree) ?? {
      id: node.subtree,
      label: tree.subtrees.find((s) => s.id === node.subtree)?.label ?? node.subtree,
      color: tree.subtrees.find((s) => s.id === node.subtree)?.color ?? '#8a93ad',
      allocated: 0,
      total: 0,
      notablesTaken: 0,
      notablesTotal: 0,
    }
    entry.allocated += 1
    if (node.kind === 'notable' || node.kind === 'keystone') entry.notablesTaken += 1
    bySubtree.set(node.subtree, entry)
  }
  // Totals count allocatable nodes only, matching how the atlas page draws progress.
  for (const node of tree.nodes) {
    if (!isAllocatable(node)) continue
    const entry = bySubtree.get(node.subtree)
    if (!entry) continue
    entry.total += 1
    if (node.kind === 'notable' || node.kind === 'keystone') entry.notablesTotal += 1
  }

  const subtreeOrder = new Map(tree.subtrees.map((s, i) => [s.id, i]))
  const mechanics = [...bySubtree.values()]
    .filter((m) => m.id !== 'main' && m.allocated > 0)
    .sort(
      (a, b) =>
        b.notablesTaken - a.notablesTaken ||
        b.allocated - a.allocated ||
        (subtreeOrder.get(a.id) ?? 0) - (subtreeOrder.get(b.id) ?? 0),
    )
  const main = bySubtree.get('main') ?? null

  // Biomes the allocated nodes are actually restricted to.
  const biomeNodes = new Map<string, number>()
  for (const hash of allocated) {
    const node = index.byHash.get(hash)
    if (!node) continue
    for (const keyword of node.biomes) biomeNodes.set(keyword, (biomeNodes.get(keyword) ?? 0) + 1)
  }
  const biomes: StrategyBiome[] = [...biomeNodes.entries()]
    .filter(([, count]) => count >= biomeThreshold)
    .map(([keyword, count]) => ({
      keyword,
      nodes: count,
      areas: areas
        .filter((a) => a.kind === 'map' && areaInBiome(a, keyword))
        .sort((a, b) => (b.navigation ?? 0) - (a.navigation ?? 0) || a.name.localeCompare(b.name))
        .slice(0, topAreas)
        .map((a) => ({ name: a.name, navigation: a.navigation })),
    }))
    .sort((a, b) => b.nodes - a.nodes || a.keyword.localeCompare(b.keyword))

  const keystones: StrategyKeystone[] = []
  for (const hash of allocated) {
    const node = index.byHash.get(hash)
    if (node?.kind === 'keystone') {
      keystones.push({
        name: node.name,
        subtree: node.subtree,
        color: tree.subtrees.find((s) => s.id === node.subtree)?.color ?? '#8a93ad',
      })
    }
  }
  // Read in the same order the mechanics are ranked, so the card leads with the
  // keystones of the mechanic it leads with.
  const rank = new Map(mechanics.map((m, i) => [m.id, i]))
  keystones.sort(
    (a, b) => (rank.get(a.subtree) ?? mechanics.length) - (rank.get(b.subtree) ?? mechanics.length) || a.name.localeCompare(b.name),
  )

  return { allocatedCount: allocated.size, mechanics, main, biomes, keystones }
}
