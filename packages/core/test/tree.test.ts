import { describe, expect, it } from 'vitest'
import { buildEdges, nodePosition } from '../src/tree/position.js'
import type { TreeData } from '../src/types.js'

const TREE: TreeData = {
  version: 'test',
  nodes: {
    // Orbit 1 ring (radius 82, 4 slots at 90°), orbit 2 outer (radius 162).
    100: { id: 100, name: 'a', stats: [], group: 0, orbit: 1, orbitIndex: 0 },
    101: { id: 101, name: 'b', stats: [], group: 0, orbit: 1, orbitIndex: 1 },
    102: { id: 102, name: 'c', stats: [], group: 0, orbit: 2, orbitIndex: 1 },
    // Far-away mastery-style node linked explicitly from 100 (dropped by maxLen).
    900: { id: 900, name: 'far', stats: [], group: 1, orbit: 0, orbitIndex: 0 },
  },
  groups: [
    { nodes: [100, 101, 102], orbits: [1, 2], x: 0, y: 0 },
    { nodes: [900], orbits: [0], x: 50000, y: 50000 },
  ],
  constants: {
    orbitRadii: [0, 82, 162],
    orbitAnglesByOrbit: [
      [0],
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    ],
    skillsPerOrbit: [1, 4, 4],
    classes: {},
  },
  classes: [],
  bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
}

describe('nodePosition', () => {
  it('places nodes on their orbit using group + radius + angle', () => {
    const p = nodePosition(TREE.nodes[101], TREE)!
    expect(p.x).toBeCloseTo(0, 5)
    expect(p.y).toBeCloseTo(82, 5)
  })

  it('returns null for nodes whose group has no coordinates', () => {
    expect(nodePosition(TREE.nodes[900], TREE)).toEqual({ x: 50000, y: 50000 })
  })
})

describe('buildEdges', () => {
  it('infers ring neighbours within an orbit and drops far connections', () => {
    const edges = buildEdges(TREE)
    const keys = edges.map(([a, b]) => `${a}-${b}`).sort()
    // 100-101 ring neighbours on orbit 1; 101-102 nearest-angle across orbits.
    expect(keys).toContain('100-101')
    expect(keys).toContain('101-102')
    // Explicit 100-900 connection spans the tree and must be filtered out.
    expect(keys).not.toContain('100-900')
    expect(keys).not.toContain('900-100')
  })
})
