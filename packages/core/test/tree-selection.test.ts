import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAscendancy, resolveStartNode, validateTreeSelection } from '../src/tree/leveling.js'
import { loadTreeFixture } from './helpers/tree-fixture.js'

const TREE = loadTreeFixture()
const WITCH_START = resolveStartNode(TREE, 'Witch')!

/**
 * The same graph the app renders with: GGG's own edge list from the tree-art
 * pack. `node.connections` is deliberately not used here — it only carries part
 * of the real graph, which is the whole reason this parameter exists.
 */
const EDGES: [number, number][] = (
  JSON.parse(readFileSync(new URL('../../data/tree-art/geometry.json', import.meta.url), 'utf-8')) as {
    edges: [string, string][]
  }
).edges.map(([a, b]) => [Number(a), Number(b)])

const adjacent = new Map<number, number[]>()
for (const [a, b] of EDGES) {
  if (!adjacent.has(a)) adjacent.set(a, [])
  if (!adjacent.has(b)) adjacent.set(b, [])
  adjacent.get(a)!.push(b)
  adjacent.get(b)!.push(a)
}

const ascendancyIds = (name: string) =>
  Object.values(TREE.nodes)
    .filter((n) => n.ascendancyName === name)
    .map((n) => n.id)

/**
 * Grow a selection outward from `from` through **main-tree nodes only**.
 * Ascendancy nodes hang directly off every class start, so a plain walk would
 * pick them up and make the expectations hard to read.
 */
function walkMain(from: number, steps: number): number[] {
  const picked = [from]
  const seen = new Set(picked)
  let frontier = [from]
  for (let depth = 0; depth < steps; depth++) {
    const next: number[] = []
    for (const id of frontier) {
      for (const nb of adjacent.get(id) ?? []) {
        const target = TREE.nodes[nb]
        if (!target || isAscendancy(target) || seen.has(nb)) continue
        seen.add(nb)
        picked.push(nb)
        next.push(nb)
      }
    }
    frontier = next
  }
  return picked
}

const check = (selected: number[], start: number | null = WITCH_START) =>
  validateTreeSelection(TREE, selected, start, EDGES)

describe('validateTreeSelection', () => {
  it('accepts a path grown outward from the class start', () => {
    const selected = walkMain(WITCH_START, 2)
    expect(selected.length).toBeGreaterThan(5)
    const result = check(selected)
    expect(result.orphans).toEqual([])
    expect(result.duplicates).toEqual([])
    expect(result.ascendancy).toEqual([])
    // The start anchors the walk rather than being spent on, and it is
    // reported like any other selected node.
    expect(result.reachable).toEqual(selected)
  })

  it('flags a node picked without the path that leads to it', () => {
    // Three rings out, then keep only the outermost node: its route back runs
    // through nodes that were not selected, which is what the game refuses.
    const threeOut = walkMain(WITCH_START, 3)
    const far = threeOut[threeOut.length - 1]
    const result = check([WITCH_START, far])
    expect(result.orphans).toEqual([far])
    expect(result.reachable).toEqual([WITCH_START])

    // Selecting the whole neighbourhood it came from makes it legal again.
    expect(check(threeOut).orphans).toEqual([])
  })

  it('reports ids that are not in this tree at all', () => {
    expect(check([...walkMain(WITCH_START, 1), 999999]).orphans).toEqual([999999])
  })

  it('cannot route through an ascendancy node', () => {
    const ascNeighbours = (adjacent.get(WITCH_START) ?? [])
      .map((id) => TREE.nodes[id])
      .filter((n) => n && isAscendancy(n))
    expect(ascNeighbours.length).toBeGreaterThan(0)

    // Selecting the start plus an ascendancy node next to it leaves the
    // ascendancy node categorised on its own: never reachable tree, never an
    // orphan.
    const result = check([WITCH_START, ascNeighbours[0].id])
    expect(result.ascendancy).toEqual([ascNeighbours[0].id])
    expect(result.orphans).toEqual([])
    expect(result.reachable).toEqual([WITCH_START])
  })

  it('lists every ascendancy node of the chosen ascendancy separately', () => {
    const asc = ascendancyIds('Infernalist')
    expect(asc.length).toBeGreaterThan(0)
    const result = check([...walkMain(WITCH_START, 2), ...asc])
    expect(result.ascendancy).toEqual(asc)
    expect(result.orphans).toEqual([])
  })

  it('reports duplicates without letting them inflate the result', () => {
    const selected = walkMain(WITCH_START, 1)
    const result = check([...selected, selected[1], selected[1]])
    expect(result.duplicates).toEqual([selected[1]])
    expect(result.reachable).toEqual(selected)
  })

  it('treats every known node as reachable when the class is unknown', () => {
    const selected = walkMain(WITCH_START, 1)
    const result = check(selected, null)
    // Without a class there is no start node, so connectivity cannot be judged
    // and the caller decides what to say about the missing class.
    expect(result.reachable).toEqual(selected)
    expect(result.orphans).toEqual([])
  })

  it('anchors a walk for every shipped class', () => {
    for (const klass of TREE.classes) {
      const start = resolveStartNode(TREE, klass.name)
      expect(start, klass.name).not.toBeNull()
      const selected = walkMain(start!, 2)
      expect(selected.length, klass.name).toBeGreaterThan(5)
      expect(check(selected, start).orphans, klass.name).toEqual([])
    }
  })

  it('agrees with the graph it is given rather than with node.connections', () => {
    // A node reachable through an official edge but absent from
    // `node.connections` must count as reachable, or a legal tree would be
    // reported as broken.
    const reachableViaEdges = walkMain(WITCH_START, 2)
    const declared = new Set<number>()
    for (const id of reachableViaEdges) {
      for (const c of TREE.nodes[id]?.connections ?? []) declared.add(c.id)
    }
    const onlyViaEdges = reachableViaEdges.filter((id) => id !== WITCH_START && !declared.has(id))
    expect(onlyViaEdges.length).toBeGreaterThan(0)
    expect(check(reachableViaEdges).orphans).toEqual([])
  })
})
