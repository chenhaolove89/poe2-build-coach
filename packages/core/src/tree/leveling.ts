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
