import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ASCENDANCY_POINT_CAP, countPoints, grantedPoints, isFreeNode } from '../src/tree/points.js'
import { resolveStartNode } from '../src/tree/leveling.js'
import { loadTreeFixture } from './helpers/tree-fixture.js'

const TREE = loadTreeFixture()
const WITCH_START = resolveStartNode(TREE, 'Witch')!

/** The graph the renderer draws and the connectivity check walks. */
const EDGES: [number, number][] = (
  JSON.parse(readFileSync(new URL('../../data/tree-art/geometry.json', import.meta.url), 'utf-8')) as {
    edges: [string, string][]
  }
).edges.map(([a, b]) => [Number(a), Number(b)])

const count = (selected: number[], options: { level: number | null; questPoints?: number }) =>
  countPoints(TREE, selected, options, EDGES)

const byStat = (re: RegExp) => Object.values(TREE.nodes).filter((n) => (n.stats ?? []).some((s) => re.test(s)))

describe('point accounting', () => {
  it('gives one point per level, so nothing at 1 and 99 at 100', () => {
    expect(count([], { level: 1, questPoints: 0 }).mainCap).toBe(0)
    expect(count([], { level: 100, questPoints: 0 }).mainCap).toBe(99)
    expect(count([], { level: 88, questPoints: 0 }).mainCap).toBe(87)
  })

  it('adds the campaign books, and defaults to all of them', () => {
    expect(count([], { level: 100, questPoints: 0 }).mainCap).toBe(99)
    expect(count([], { level: 100, questPoints: 12 }).mainCap).toBe(111)
    // 123 is the ceiling at level 100 with all twelve books, which is also what
    // Path of Building assumes when it warns about over-allocation.
    expect(count([], { level: 100 }).mainCap).toBe(123)
    // A book count beyond the campaign cannot raise the ceiling.
    expect(count([], { level: 100, questPoints: 999 }).mainCap).toBe(123)
  })

  it('has no cap without a level, since 1 point per level is the rule', () => {
    expect(count([], { level: null }).mainCap).toBeNull()
  })

  it('caps ascendancy at 8', () => {
    expect(count([], { level: 100 }).ascendancyCap).toBe(ASCENDANCY_POINT_CAP)
    const infernalist = Object.values(TREE.nodes).filter((n) => n.ascendancyName === 'Infernalist')
    // The cluster is 23 nodes but most sit behind choices; what matters here is
    // that every one of them is counted against the ascendancy pool, not main.
    const budget = count(infernalist.map((n) => n.id), { level: 100 })
    expect(budget.mainUsed).toBe(0)
    expect(budget.ascendancyUsed).toBeGreaterThan(ASCENDANCY_POINT_CAP)
  })

  it('does not charge for the class start, an ascendancy start, or free nodes', () => {
    const free = Object.values(TREE.nodes).filter(isFreeNode)
    expect(free.length).toBeGreaterThan(20)
    const budget = count(free.map((n) => n.id), { level: 100 })
    expect(budget.mainUsed).toBe(0)
    expect(budget.ascendancyUsed).toBe(0)
    expect(isFreeNode(TREE.nodes[WITCH_START])).toBe(true)
  })

  it('counts a normal node as a point', () => {
    const plain = Object.values(TREE.nodes).find(
      (n) => !n.ascendancyName && !isFreeNode(n) && (n.stats ?? []).length > 0,
    )!
    expect(count([plain.id], { level: 100 }).mainUsed).toBe(1)
  })

  it('raises the ceiling for the ascendancies that grant points', () => {
    // A flat 123 would reject these trees, which the game allows.
    const oracle = byStat(/Grants 1 Passive Skill Point/i).filter((n) => n.ascendancyName === 'Oracle')
    const pathfinder = byStat(/Grants \d Passive Skill Point/i).filter((n) => n.ascendancyName === 'Pathfinder')
    expect(oracle.length).toBe(2)
    expect(grantedPoints(TREE, oracle.map((n) => n.id), EDGES)).toBe(2)
    expect(grantedPoints(TREE, pathfinder.map((n) => n.id), EDGES)).toBe(6)
    expect(count([], { level: 100 }).mainCap! + 2).toBe(125)
  })

  it('credits only the granting nodes that are actually selected', () => {
    const one = byStat(/Grants 1 Passive Skill Point/i)[0]
    expect(count([one.id], { level: 100 }).granted).toBe(1)
    expect(count([], { level: 100 }).granted).toBe(0)
  })
})
