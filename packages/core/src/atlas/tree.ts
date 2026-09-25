/**
 * The Atlas passive tree — the endgame's own skill tree, and the half of "what
 * should I farm" that the map table cannot answer.
 *
 * The map table says what an area is; this says what the tree does to it. Every
 * node belongs to a subtree, and the subtrees are the mechanics (Breach, Delirium,
 * Ritual, Expedition, Abyss, Incursion) plus the generic main tree — so a node's
 * subtree is exactly the answer to "which mechanic does this improve", which is
 * what ties the tree to a farming plan.
 *
 * Pure: the tree is handed in, never loaded. `scripts/build-atlas.mjs` bakes it
 * from the public data export, coordinates included, so nothing here does geometry.
 */

export type AtlasNodeKind = 'normal' | 'notable' | 'keystone' | 'root' | 'mastery'

export interface AtlasNode {
  /** The game's node id, and the key everything else uses. */
  hash: number
  /** Internal id, e.g. `AtlasExpeditionNotable8`. Stable across name changes. */
  id: string
  name: string
  kind: AtlasNodeKind
  /** Which tree the node sits on: `main`, or a mechanic id like `Breach`. */
  subtree: string
  /** Raw effect lines, still carrying the source's `[Id|Label]` markup. */
  stats: string[]
  /**
   * The game's own icon path for this node (e.g.
   * `Art/2DArt/SkillIcons/passives/AtlasTrees/ExpeditionNotable5.dds`). The export
   * has one for every node; no complete converted icon set is publicly available
   * yet, so the renderer still self-draws, but any future icon pack maps by this
   * path without touching the data pipeline again.
   */
  icon: string | null
  /**
   * Biomes the effect is restricted to, as the tree itself names them ("Mountain",
   * "City"). This is the join back to the map table: a node that says "in Mountain
   * Areas" is what you take for the Mountain maps you are farming, in the game's own
   * wording rather than a mapping someone authored.
   */
  biomes: string[]
  flavour: string
  x: number
  y: number
  group: number
  orbit: number
  orbitIndex: number
  connections: number[]
  /** True for the seven entry nodes, one per subtree. */
  root: boolean
}

export interface AtlasSubtree {
  id: string
  label: string
  color: string
  root: number | null
  count: number
  notables: number
}

export interface AtlasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * One link. `[from, to]` is a straight line; `[from, to, radius, sweep]` is the arc
 * the game curves it into, with `radius` in world units and `sweep` as the SVG arc
 * flag. Baking the choice here keeps the renderer free of orbit arithmetic.
 */
export type AtlasEdge = [number, number] | [number, number, number, number]

export interface AtlasTree {
  source: string
  captured: string
  bounds: AtlasBounds
  /** Biome keywords the tree names, for offering as filters. */
  biomeKeywords: string[]
  subtrees: AtlasSubtree[]
  nodes: AtlasNode[]
  edges: AtlasEdge[]
}

export interface AtlasIndex {
  byHash: ReadonlyMap<number, AtlasNode>
  bySubtree: ReadonlyMap<string, AtlasNode[]>
  /** Undirected adjacency, so a walk does not depend on which end lists the link. */
  neighbours: ReadonlyMap<number, number[]>
}

/**
 * An effect line as a player reads it.
 *
 * The export writes keyword references as `[InternalId|Display]` and occasionally
 * as a bare `[InternalId]`. The display half is the game's own wording, so it wins;
 * a bare id is split on its capitals as a last resort, which is readable and
 * visibly a fallback rather than a guess at a translation.
 */
export function atlasStatText(raw: string): string {
  return raw
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, (_m, _id, label) => label)
    .replace(/\[([^\]]+)\]/g, (_m, id: string) => id.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    .trim()
}

export function buildAtlasIndex(tree: AtlasTree): AtlasIndex {
  const byHash = new Map<number, AtlasNode>()
  const bySubtree = new Map<string, AtlasNode[]>()
  const neighbours = new Map<number, number[]>()

  for (const node of tree.nodes) {
    if (!byHash.has(node.hash)) byHash.set(node.hash, node)
    const bucket = bySubtree.get(node.subtree)
    if (bucket) bucket.push(node)
    else bySubtree.set(node.subtree, [node])
    if (!neighbours.has(node.hash)) neighbours.set(node.hash, [])
  }
  for (const [a, b] of tree.edges) {
    if (!byHash.has(a) || !byHash.has(b)) continue
    neighbours.get(a)?.push(b)
    neighbours.get(b)?.push(a)
  }
  return { byHash, bySubtree, neighbours }
}

/**
 * Whether a node can ever be allocated.
 *
 * Mastery slots are the tree's icon-only markers — they have no effect and the game
 * never lets a point go into one, so a planner that offered them would be wrong.
 */
export function isAllocatable(node: AtlasNode): boolean {
  return node.kind !== 'mastery'
}

/** A node is reachable when it is an entry point or touches an allocated node. */
export function canAllocate(index: AtlasIndex, allocated: ReadonlySet<number>, hash: number): boolean {
  const node = index.byHash.get(hash)
  if (!node || !isAllocatable(node)) return false
  if (allocated.has(hash)) return false
  if (node.root) return true
  for (const n of index.neighbours.get(hash) ?? []) if (allocated.has(n)) return true
  return false
}

/**
 * The nodes to allocate, in order, to reach `hash` from what is already taken.
 *
 * Breadth-first from the whole allocated set at once, so the answer is the shortest
 * path and ties resolve to the earliest-discovered neighbour. An empty result means
 * the node is already allocated; null means it is unreachable — which for an
 * untouched tree means "no entry point on this subtree yet", a real state the game
 * also has.
 */
export function pathTo(index: AtlasIndex, allocated: ReadonlySet<number>, hash: number): number[] | null {
  const target = index.byHash.get(hash)
  if (!target || !isAllocatable(target)) return null
  if (allocated.has(hash)) return []

  const from = new Map<number, number | null>()
  const queue: number[] = []
  // Every entry point is a legal start whether or not it has been taken yet -- that
  // is exactly how a new subtree gets opened -- so all of them seed the walk, and
  // an untaken one simply shows up in the returned path.
  for (const n of index.byHash.values()) {
    if (!n.root || !isAllocatable(n)) continue
    from.set(n.hash, null)
    queue.push(n.hash)
  }
  for (const h of allocated) {
    if (from.has(h)) continue
    from.set(h, null)
    queue.push(h)
  }
  if (queue.length === 0) return null

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current === hash) {
      const path: number[] = []
      let cursor: number | null = current
      while (cursor != null) {
        path.push(cursor)
        cursor = from.get(cursor) ?? null
      }
      // Drop the already-allocated start of the chain, keep allocation order.
      return path.filter((h) => !allocated.has(h)).reverse()
    }
    for (const next of index.neighbours.get(current) ?? []) {
      if (from.has(next)) continue
      const node = index.byHash.get(next)
      if (!node || !isAllocatable(node)) continue
      from.set(next, current)
      queue.push(next)
    }
  }
  return null
}

export interface AllocationCheck {
  ok: boolean
  /** Allocated nodes that no entry point can reach through allocated nodes — the
   *  game would not allow these, so a saved plan carrying them is corrupt. */
  orphans: number[]
}

/**
 * Whether a whole allocation is legal.
 *
 * The rule is reachability, not adjacency: every allocated node must be connected
 * to an allocated *entry point* through allocated nodes. "Has an allocated
 * neighbour" looks equivalent but is not — a pair of nodes pointing at each other
 * and nothing else satisfies it while being impossible to build, which is exactly
 * the state left behind when the middle of a chain is taken back.
 */
export function validateAllocation(index: AtlasIndex, allocated: ReadonlySet<number>): AllocationCheck {
  const reached = new Set<number>()
  const queue: number[] = []
  for (const hash of allocated) {
    if (index.byHash.get(hash)?.root) {
      reached.add(hash)
      queue.push(hash)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const next of index.neighbours.get(queue[head]) ?? []) {
      if (!allocated.has(next) || reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }
  const orphans = [...allocated].filter((h) => !reached.has(h))
  return { ok: orphans.length === 0, orphans }
}

export interface SubtreeProgress {
  id: string
  label: string
  color: string
  /** Nodes allocated, out of every allocatable node on this subtree. */
  allocated: number
  total: number
  /** Notable and keystone nodes taken, out of how many there are. */
  notablesTaken: number
  notablesTotal: number
  /** Whether any node on this subtree can be reached yet. */
  unlocked: boolean
}

/**
 * Per-subtree progress, which is how a plan reads against a farming intention:
 * "I am farming Breach, so how far into the Breach tree am I".
 */
export function subtreeProgress(index: AtlasIndex, tree: AtlasTree, allocated: ReadonlySet<number>): SubtreeProgress[] {
  return tree.subtrees.map((subtree) => {
    const members = (index.bySubtree.get(subtree.id) ?? []).filter(isAllocatable)
    const taken = members.filter((n) => allocated.has(n.hash))
    const notables = members.filter((n) => n.kind === 'notable' || n.kind === 'keystone')
    return {
      id: subtree.id,
      label: subtree.label,
      color: subtree.color,
      allocated: taken.length,
      total: members.length,
      notablesTaken: taken.filter((n) => n.kind === 'notable' || n.kind === 'keystone').length,
      notablesTotal: notables.length,
      unlocked: members.some((n) => canAllocate(index, allocated, n.hash)) || taken.length > 0,
    }
  })
}

/** The effect lines a set of allocated nodes grants, grouped by subtree. */
export function allocatedEffects(index: AtlasIndex, allocated: ReadonlySet<number>): { subtree: string; lines: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const hash of allocated) {
    const node = index.byHash.get(hash)
    if (!node || node.stats.length === 0) continue
    const lines = groups.get(node.subtree) ?? []
    for (const raw of node.stats) lines.push(atlasStatText(raw))
    groups.set(node.subtree, lines)
  }
  return [...groups.entries()].map(([subtree, lines]) => ({ subtree, lines }))
}

/**
 * Remove a node and everything that hung off it.
 *
 * Taking a point back in the middle of a chain has to take the chain beyond it too:
 * the game will not leave a node allocated with no allocated neighbour, and a
 * planner that did would show a plan the player cannot actually build. Entry points
 * survive because they never needed a neighbour.
 */
export function unallocate(index: AtlasIndex, allocated: ReadonlySet<number>, hash: number): Set<number> {
  const next = new Set(allocated)
  next.delete(hash)
  for (;;) {
    const { orphans } = validateAllocation(index, next)
    const real = orphans.filter((h) => next.has(h))
    if (real.length === 0) return next
    for (const h of real) next.delete(h)
  }
}

/**
 * The biome keyword the atlas tree would use for a map-table biome.
 *
 * The map table names the three cities separately (Ezomyte City, Faridun City, Vaal
 * City) because they are distinct on the Atlas; the tree addresses them together as
 * "City Areas", since one node covers all of them. "Non-City" also ends in "City"
 * but is the tree's own bucket for everything else, so it must pass through — the
 * complement join in the strategy brief depends on it. Everything else matches by
 * name.
 */
export function atlasBiomeKey(mapBiome: string): string {
  return mapBiome !== 'Non-City' && /City$/.test(mapBiome) ? 'City' : mapBiome
}

/** Atlas nodes whose effect is restricted to a map-table biome. */
export function atlasNodesForBiome(index: AtlasIndex, biome: string): AtlasNode[] {
  const key = atlasBiomeKey(biome)
  return [...index.byHash.values()].filter((n) => n.biomes.includes(key))
}
