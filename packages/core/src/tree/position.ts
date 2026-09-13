import type { TreeData, TreeNode } from '../types.js'

export interface NodePosition {
  x: number
  y: number
}

/**
 * PoE trees store no explicit node coordinates: a node sits on its group at
 * (group.x, group.y) offset by the orbit radius at the orbit's angle.
 * This mirrors how PoB lays out the tree.
 */
export function nodePosition(node: TreeNode, tree: TreeData): NodePosition | null {
  const group = tree.groups[node.group]
  if (!group) return null
  const radius = tree.constants.orbitRadii[node.orbit] ?? 0
  const angles = tree.constants.orbitAnglesByOrbit[node.orbit]
  // PoB2 stores orbit angles in radians (0..2π).
  const angle = angles?.[node.orbitIndex] ?? 0
  return {
    x: group.x + Math.cos(angle) * radius,
    y: group.y + Math.sin(angle) * radius,
  }
}

/** Direct neighbour ids from the node's connection list. */
export function nodeNeighbours(node: TreeNode): number[] {
  return (node.connections ?? []).map((c) => c.id)
}

const TAU = Math.PI * 2

function angleOf(node: TreeNode, tree: TreeData): number {
  return tree.constants.orbitAnglesByOrbit[node.orbit]?.[node.orbitIndex] ?? 0
}

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % TAU
  return Math.min(d, TAU - d)
}

/**
 * Deduplicated drawable edges. Two sources:
 * 1. explicit `connections` (length-filtered: mastery links span the whole
 *    tree and are dropped), and
 * 2. inferred orbit topology — ring neighbours within one orbit and
 *    nearest-angle links between adjacent orbits — because PoB2's
 *    connections list only carries part of the real graph.
 */
export function buildEdges(tree: TreeData, maxLen = 1500): [number, number][] {
  const seen = new Set<string>()
  const out: [number, number][] = []
  const add = (a: number, b: number) => {
    if (a === b) return
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(a < b ? [a, b] : [b, a])
  }

  const positioned = new Map<number, TreeNode>()
  for (const node of Object.values(tree.nodes)) {
    if (nodePosition(node, tree)) positioned.set(node.id, node)
  }

  for (const node of positioned.values()) {
    const from = nodePosition(node, tree)!
    for (const nid of nodeNeighbours(node)) {
      if (nid <= node.id) continue
      const other = positioned.get(nid)
      if (!other) continue
      const to = nodePosition(other, tree)!
      const dx = from.x - to.x
      const dy = from.y - to.y
      if (dx * dx + dy * dy > maxLen * maxLen) continue
      add(node.id, nid)
    }
  }

  const skillsPerOrbit = tree.constants.skillsPerOrbit ?? []
  const byGroup = new Map<number, Map<number, TreeNode[]>>()
  for (const node of positioned.values()) {
    let orbits = byGroup.get(node.group)
    if (!orbits) {
      orbits = new Map()
      byGroup.set(node.group, orbits)
    }
    const ring = orbits.get(node.orbit)
    if (ring) ring.push(node)
    else orbits.set(node.orbit, [node])
  }

  for (const orbits of byGroup.values()) {
    const orbitNums = [...orbits.keys()].sort((a, b) => a - b)

    // Ring neighbours within one orbit (closure allowed when nearly full).
    for (const o of orbitNums) {
      const ring = orbits.get(o)!.sort((x, y) => x.orbitIndex - y.orbitIndex)
      if (ring.length < 2) continue
      const step = TAU / (skillsPerOrbit[o] ?? 12)
      for (let i = 0; i + 1 < ring.length; i++) {
        if (angDiff(angleOf(ring[i], tree), angleOf(ring[i + 1], tree)) <= step * 1.6) {
          add(ring[i].id, ring[i + 1].id)
        }
      }
      const wrap = angDiff(angleOf(ring[0], tree), angleOf(ring[ring.length - 1], tree))
      if (ring.length > 2 && wrap <= step * 1.6) add(ring[0].id, ring[ring.length - 1].id)
    }

    // Nearest-angle link between adjacent orbits (orbit 0 sits at the group
    // centre where angle is meaningless, so its links stay connection-only).
    for (let k = 0; k + 1 < orbitNums.length; k++) {
      const inner = orbits.get(orbitNums[k])!
      const outer = orbits.get(orbitNums[k + 1])!
      if (orbitNums[k] === 0) continue
      const innerStep = TAU / (skillsPerOrbit[orbitNums[k]] ?? 12)
      const outerStep = TAU / (skillsPerOrbit[orbitNums[k + 1]] ?? 12)
      const tolerance = Math.max(innerStep, outerStep) * 1.25
      for (const b of outer) {
        let best: TreeNode | null = null
        let bestDiff = Infinity
        for (const a of inner) {
          const d = angDiff(angleOf(a, tree), angleOf(b, tree))
          if (d < bestDiff) {
            bestDiff = d
            best = a
          }
        }
        if (best && bestDiff <= tolerance) add(best.id, b.id)
      }
    }
  }

  return out
}

export function treeBounds(tree: TreeData): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const g of tree.groups) {
    if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') continue
    minX = Math.min(minX, g.x)
    minY = Math.min(minY, g.y)
    maxX = Math.max(maxX, g.x)
    maxY = Math.max(maxY, g.y)
  }
  return { minX, minY, maxX, maxY }
}
