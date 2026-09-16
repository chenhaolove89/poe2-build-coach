import { nodePosition } from './position.js'
import type { TreeData, TreeNode } from '../types.js'

export interface LevelingStep {
  /** 1-based allocation order (excluding the free class start). */
  order: number
  nodeId: number
  name: string
  /** True when this node is part of the target build, false for path-forcing connectors. */
  isTarget: boolean
}

export interface LevelingPlan {
  steps: LevelingStep[]
  /** Allocated targets that cannot be pathed to from the class start — ascendancy nodes. */
  unreachable: TreeNode[]
  startNodeId: number | null
}

/** Find the class start node for a character class name (PoE1 or PoE2 name). */
export function resolveStartNode(tree: TreeData, className: string | null): number | null {
  if (!className) return null
  for (const node of Object.values(tree.nodes)) {
    if (Array.isArray(node.classesStart) && node.classesStart.includes(className)) return node.id
  }
  return null
}

/**
 * Turn a target node set into an allocation order: repeatedly run a
 * multi-source BFS from the already-allocated set and pick the closest
 * target, allocating every node on the path to it. Ascendancy nodes are not
 * connected to the main tree and come back as `unreachable` (they are bought
 * in the labyrinth, not pathed to).
 *
 * The graph uses every explicit `connections` entry, NOT the length-filtered
 * drawable edges: class start nodes carry a misplaced group reference in the
 * data, so their edges would be wrongly dropped by visual filtering, and in
 * game any allocated node is a valid path.
 */
export function buildLevelingPlan(tree: TreeData, targetNodes: number[], startNodeId: number | null): LevelingPlan {
  const allocated = new Set<number>(startNodeId != null ? [startNodeId] : [])
  // Ascendancy nodes are bought in the labyrinth; their data often carries a
  // connector line into the main tree, so exclude them from pathing outright.
  const targets = new Set(
    targetNodes.filter((id) => {
      const node = tree.nodes[id]
      return node && !isAscendancy(node) && !allocated.has(id)
    }),
  )
  const unreachable = targetNodes
    .map((id) => tree.nodes[id])
    .filter((n) => n && isAscendancy(n) && !targets.has(n.id))

  const adjacency = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    if (!tree.nodes[a] || !tree.nodes[b]) return
    if (!adjacency.has(a)) adjacency.set(a, [])
    if (!adjacency.has(b)) adjacency.set(b, [])
    adjacency.get(a)!.push(b)
    adjacency.get(b)!.push(a)
  }
  for (const node of Object.values(tree.nodes)) {
    for (const c of node.connections ?? []) link(node.id, c.id)
  }

  const steps: LevelingStep[] = []
  let pending = [...targets]

  while (pending.length > 0) {
    const { dist, prev } = bfsFromAllocated(adjacency, allocated)
    let best = -1
    let bestDist = Infinity
    for (const id of pending) {
      const d = dist.get(id)
      if (d === undefined) continue
      if (d < bestDist) {
        bestDist = d
        best = id
      }
    }
    if (best === -1) {
      // No reachable target remains — anything pending is unreachable.
      for (const id of pending) unreachable.push(tree.nodes[id])
      break
    }
    // Walk the path back from `best` to the allocated frontier and allocate it.
    const path: number[] = []
    let cur = best
    while (!allocated.has(cur)) {
      path.push(cur)
      const p = prev.get(cur)
      if (p === undefined) break
      cur = p
    }
    for (const id of path.reverse()) {
      allocated.add(id)
      const node = tree.nodes[id]
      steps.push({ order: steps.length + 1, nodeId: id, name: node?.name ?? String(id), isTarget: targets.has(id) })
    }
    pending = pending.filter((id) => !allocated.has(id))
  }

  return { steps, unreachable, startNodeId }
}

/** Ascendancy marker: PoE2 tree data flags these via ascendancyName. */
export function isAscendancy(node: TreeNode): boolean {
  return node.ascendancyName != null || node.isAscendancyStart != null
}

export interface TreeSelectionCheck {
  /** Selected nodes reachable from the class start through other selected nodes. */
  reachable: number[]
  /**
   * Selected nodes with no path back to the class start — a tree the game would
   * refuse to allocate. Ids that are not in the tree at all land here too,
   * since the game cannot allocate those either.
   */
  orphans: number[]
  /** Selected nodes on an ascendancy tree, which is bought separately. */
  ascendancy: number[]
  /** Ids listed more than once, in first-seen order. */
  duplicates: number[]
}

/**
 * Check a hand-picked node set the way the game would.
 *
 * Connectivity is walked *inside the selection*: a node only counts as
 * reachable when every step of the path to it is selected too, because that is
 * what "this tree can actually be allocated" means. Ascendancy nodes sit out
 * that walk for the same reason {@link buildLevelingPlan} excludes them — they
 * are bought with trial points, and a class start connects to its ascendancy
 * nodes directly, so routing through them is not allowed.
 *
 * `edges` is the graph to walk, and it has to be supplied rather than read from
 * `node.connections`: that field only carries part of the real graph, which is
 * why {@link buildEdges} exists to infer the rest. Callers should pass the same
 * edge set they display, so "connected" on screen and "connected" here agree.
 *
 * A null `startNodeId` means the class is unknown and connectivity cannot be
 * judged at all; every known node then counts as reachable, and the caller
 * decides what to say about the missing class.
 */
export function validateTreeSelection(
  tree: TreeData,
  selected: number[],
  startNodeId: number | null,
  edges: readonly (readonly [number, number])[],
): TreeSelectionCheck {
  const seen = new Set<number>()
  const duplicates: number[] = []
  const unique: number[] = []
  for (const id of selected) {
    if (seen.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id)
      continue
    }
    seen.add(id)
    unique.push(id)
  }

  const inSelection = new Set(unique.filter((id) => tree.nodes[id] && !isAscendancy(tree.nodes[id])))
  // The start anchors the walk even when it was not picked explicitly: a
  // character always has its class start allocated.
  if (startNodeId != null) inSelection.add(startNodeId)

  const reached = new Set<number>()
  if (startNodeId != null && tree.nodes[startNodeId]) {
    // The start is always reachable, even when it is the only thing selected —
    // there is nothing for it to be disconnected from.
    reached.add(startNodeId)
    const adjacency = new Map<number, number[]>()
    const link = (a: number, b: number) => {
      const bucket = adjacency.get(a)
      if (bucket) bucket.push(b)
      else adjacency.set(a, [b])
    }
    for (const [a, b] of edges) {
      if (!inSelection.has(a) || !inSelection.has(b)) continue
      link(a, b)
      link(b, a)
    }
    const queue = [startNodeId]
    for (let head = 0; head < queue.length; head++) {
      for (const next of adjacency.get(queue[head]) ?? []) {
        if (reached.has(next)) continue
        reached.add(next)
        queue.push(next)
      }
    }
  }

  // Both lists keep the caller's own order, so a UI can show them as picked.
  const reachable: number[] = []
  const orphans: number[] = []
  const ascendancy: number[] = []
  for (const id of unique) {
    const node = tree.nodes[id]
    if (!node) {
      // Not in this tree at all, so the game cannot allocate it either.
      orphans.push(id)
      continue
    }
    if (isAscendancy(node)) {
      ascendancy.push(id)
      continue
    }
    if (startNodeId == null || reached.has(id)) reachable.push(id)
    else orphans.push(id)
  }

  return { reachable, orphans, ascendancy, duplicates }
}

function bfsFromAllocated(
  adjacency: Map<number, number[]>,
  allocated: Set<number>,
): { dist: Map<number, number>; prev: Map<number, number> } {
  const dist = new Map<number, number>()
  const prev = new Map<number, number>()
  const queue: number[] = []
  for (const id of allocated) {
    dist.set(id, 0)
    queue.push(id)
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const d = dist.get(cur)!
    for (const next of adjacency.get(cur) ?? []) {
      if (dist.has(next)) continue
      dist.set(next, d + 1)
      prev.set(next, cur)
      queue.push(next)
    }
  }
  return { dist, prev }
}

/** Node position helper re-export for UI convenience (null when unplaced). */
export function nodePlaced(tree: TreeData, id: number): boolean {
  const node = tree.nodes[id]
  return !!node && !!nodePosition(node, tree)
}
