import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildLevelingPlan, resolveStartNode } from '../src/tree/leveling.js'
import { parsePobCode } from '../src/pob/parse.js'
import { loadTreeFixture } from './helpers/tree-fixture.js'

const TREE = loadTreeFixture()

describe('resolveStartNode', () => {
  it('maps PoE2 and PoE1 class names to the same start node', () => {
    const huntress = resolveStartNode(TREE, 'Huntress')
    const ranger = resolveStartNode(TREE, 'Ranger')
    expect(huntress).not.toBeNull()
    expect(huntress).toBe(ranger)
  })

  it('returns null for unknown class', () => {
    expect(resolveStartNode(TREE, 'Necromancer')).toBeNull()
    expect(resolveStartNode(TREE, null)).toBeNull()
  })
})

describe('buildLevelingPlan (small synthetic chain)', () => {
  const MINI: any = {
    version: 'mini',
    nodes: {
      1: { id: 1, name: 'START', stats: [], group: 0, orbit: 0, orbitIndex: 0, classesStart: ['Test'], connections: [{ id: 2 }] },
      2: { id: 2, name: 'mid', stats: [], group: 1, orbit: 0, orbitIndex: 0, connections: [{ id: 1 }, { id: 3 }] },
      3: { id: 3, name: 'far', stats: [], group: 2, orbit: 0, orbitIndex: 0, connections: [{ id: 2 }] },
    },
    groups: [
      { nodes: [1], orbits: [0], x: 0, y: 0 },
      { nodes: [2], orbits: [0], x: 100, y: 0 },
      { nodes: [3], orbits: [0], x: 200, y: 0 },
    ],
    constants: { orbitRadii: [0], orbitAnglesByOrbit: [[0]], skillsPerOrbit: [1], classes: {} },
    classes: [],
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 0 },
  }

  it('allocates intermediate nodes before farther targets', () => {
    const plan = buildLevelingPlan(MINI, [3], 1)
    expect(plan.steps.map((s) => s.nodeId)).toEqual([2, 3])
    expect(plan.steps.map((s) => s.name)).toEqual(['mid', 'far'])
    expect(plan.unreachable).toEqual([])
  })

  it('skips targets that are already allocated', () => {
    const plan = buildLevelingPlan(MINI, [1, 2, 3], 1)
    expect(plan.steps.map((s) => s.nodeId)).toEqual([2, 3])
  })
})

describe('buildLevelingPlan (real build, 158 targets)', () => {
  const code = readFileSync(new URL('./fixtures/real-sample.txt', import.meta.url), 'utf-8').trim()
  const build = parsePobCode(code)
  const start = resolveStartNode(TREE, build.className)

  it('allocates every main-tree target exactly once, ascending order', () => {
    const plan = buildLevelingPlan(TREE, build.passiveNodes, start)
    const ids = plan.steps.map((s) => s.nodeId)
    expect(new Set(ids).size).toBe(ids.length)
    // Steps may include path-forcing connectors outside the target set, but
    // every non-ascendancy target must end up covered (steps + start).
    const covered = new Set([...plan.steps.map((s) => s.nodeId), start!])
    for (const id of build.passiveNodes) {
      const node = TREE.nodes[id]
      if (node.ascendancyName) continue
      expect(covered.has(id)).toBe(true)
    }
    // Any unreachable leftovers can only be ascendancy nodes.
    expect(plan.unreachable.every((n) => n.ascendancyName)).toBe(true)
    expect(plan.steps.length).toBeGreaterThan(100)
  })

  it('routes ascendancy targets to unreachable instead of steps', () => {
    const ascNode = Object.values(TREE.nodes).find((n) => n.ascendancyName)!
    const plan = buildLevelingPlan(TREE, [...build.passiveNodes, ascNode.id], start)
    expect(plan.unreachable.some((n) => n.id === ascNode.id)).toBe(true)
    expect(plan.steps.some((s) => s.nodeId === ascNode.id)).toBe(false)
  })
})
