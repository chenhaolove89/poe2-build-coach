import { describe, expect, it } from 'vitest'
import { buildAtlasIndex } from '../src/atlas/tree.js'
import { strategyBrief } from '../src/atlas/strategy.js'
import { atlasBiomeKey, type AtlasIndex } from '../src/atlas/tree.js'
import type { MapArea } from '../src/maps/areas.js'
import type { AtlasNode, AtlasTree } from '../src/atlas/tree.js'

function node(partial: Partial<AtlasNode> & { hash: number; name: string }): AtlasNode {
  return {
    id: `Atlas_${partial.hash}`,
    kind: 'normal',
    subtree: 'main',
    stats: [],
    biomes: [],
    flavour: '',
    x: 0,
    y: 0,
    group: 0,
    orbit: 0,
    orbitIndex: 0,
    connections: [],
    root: false,
    ...partial,
  }
}

// Breach is the invested mechanic, Ritual a rider, main carries generic and biome
// nodes. Totals exclude the mastery slot, as the game does.
const NODES: AtlasNode[] = [
  node({ hash: 1, name: 'Breach root', kind: 'root', subtree: 'Breach', root: true }),
  node({ hash: 2, name: 'Breach mid', subtree: 'Breach' }),
  node({ hash: 3, name: 'Tear Open', kind: 'notable', subtree: 'Breach' }),
  node({ hash: 4, name: 'Chain Shape', kind: 'keystone', subtree: 'Breach' }),
  node({ hash: 5, name: 'Ritual root', kind: 'root', subtree: 'Ritual', root: true }),
  node({ hash: 6, name: 'Ritual notable', kind: 'notable', subtree: 'Ritual' }),
  node({ hash: 7, name: 'Ritual mastery', kind: 'mastery', subtree: 'Ritual' }),
  node({ hash: 8, name: 'Mountain one', biomes: ['Mountain'] }),
  node({ hash: 9, name: 'Mountain two', biomes: ['Mountain'] }),
  node({ hash: 10, name: 'Swamp one', biomes: ['Swamp'] }),
  node({ hash: 11, name: 'Wilds one', biomes: ['Non-City'] }),
  node({ hash: 12, name: 'Plain generic' }),
  node({ hash: 13, name: 'City one', biomes: ['City'] }),
  node({ hash: 14, name: 'City two', biomes: ['City'] }),
]

const TREE: AtlasTree = {
  source: 'test',
  captured: '2026-09-25',
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  biomeKeywords: ['Mountain', 'Swamp', 'Non-City', 'City'],
  subtrees: [
    { id: 'main', label: '主树', color: '#888888', root: null, count: 0, notables: 0 },
    { id: 'Breach', label: '裂隙', color: '#ff00ff', root: 1, count: 4, notables: 2 },
    { id: 'Ritual', label: '祭祀', color: '#00ffff', root: 5, count: 2, notables: 1 },
  ],
  nodes: NODES,
  edges: [
    [1, 2],
    [2, 3],
    [3, 4],
    [5, 6],
  ],
}

const index: AtlasIndex = buildAtlasIndex(TREE)

function area(partial: Partial<MapArea> & { name: string }): MapArea {
  return {
    code: `Map${partial.name!.replace(/\s+/g, '')}`,
    kind: 'map',
    layout: 'unknown',
    biomes: [],
    boss: null,
    note: null,
    navigation: null,
    backtracking: null,
    ...partial,
  }
}

const AREAS: MapArea[] = [
  area({ name: 'Alpine Keep', biomes: ['Mountain'], navigation: 3 }),
  area({ name: 'Bluff', biomes: ['Mountain'], navigation: 4 }),
  area({ name: 'Bog', biomes: ['Swamp'], navigation: 2 }),
  area({ name: 'Old Town', biomes: ['Ezomyte City'], navigation: 3 }),
  area({ name: 'Dunes', biomes: ['Desert'], navigation: 4 }),
  area({ name: 'Boss Arena', kind: 'boss', biomes: ['Mountain'], navigation: 4 }),
]

const ALLOCATED = new Set([1, 2, 3, 4, 5, 6, 8, 9, 10, 12])

describe('strategyBrief mechanics', () => {
  it('ranks mechanics by notables taken, with the rider second', () => {
    const brief = strategyBrief(TREE, index, ALLOCATED, AREAS)
    expect(brief.mechanics.map((m) => m.id)).toEqual(['Breach', 'Ritual'])
    expect(brief.mechanics[0]).toMatchObject({ allocated: 4, total: 4, notablesTaken: 2, notablesTotal: 2 })
  })

  it('keeps main out of the ranking but reports its own progress', () => {
    const brief = strategyBrief(TREE, index, ALLOCATED, AREAS)
    expect(brief.mechanics.map((m) => m.id)).not.toContain('main')
    // Nodes 8-12 plus the two city nodes are main's, all allocatable.
    expect(brief.main).toMatchObject({ allocated: 4, total: 7 })
  })

  it('returns no mechanics and a null main for an empty plan', () => {
    const brief = strategyBrief(TREE, index, new Set(), AREAS)
    expect(brief.mechanics).toEqual([])
    expect(brief.main).toBeNull()
    expect(brief.biomes).toEqual([])
    expect(brief.keystones).toEqual([])
    expect(brief.allocatedCount).toBe(0)
  })

  it('breaks a notables tie by points', () => {
    // Breach takes root+mid (2 points), Ritual takes its root alone (1 point): no
    // notables anywhere, so the points line decides.
    const brief = strategyBrief(TREE, index, new Set([1, 2, 5]), AREAS)
    expect(brief.mechanics.map((m) => m.id)).toEqual(['Breach', 'Ritual'])
  })
})

describe('strategyBrief biomes', () => {
  it('only targets a biome once enough allocated nodes are restricted to it', () => {
    const brief = strategyBrief(TREE, index, ALLOCATED, AREAS)
    // Mountain has two allocated nodes; Swamp has one, which is a rider, not a plan.
    expect(brief.biomes.map((b) => b.keyword)).toEqual(['Mountain'])
    expect(brief.biomes[0].nodes).toBe(2)
  })

  it('lists candidate maps best-rated first, maps only', () => {
    const brief = strategyBrief(TREE, index, ALLOCATED, AREAS)
    const mountain = brief.biomes.find((b) => b.keyword === 'Mountain')!
    expect(mountain.areas.map((a) => a.name)).toEqual(['Bluff', 'Alpine Keep'])
    // Bluff rates 4, Alpine Keep 3; the boss arena shares the biome but is not a map.
  })

  it('folds the city biomes of the table onto the one "City" keyword the tree uses', () => {
    const brief = strategyBrief(TREE, index, new Set([1, 2, 3, 4, 8, 9, 12, 13, 14]), [
      area({ name: 'Old Town', biomes: ['Ezomyte City'] }),
      area({ name: 'Sunken Ward', biomes: ['Vaal City'] }),
      area({ name: 'Alpine Keep', biomes: ['Mountain'] }),
    ])
    const city = brief.biomes.find((b) => b.keyword === 'City')!
    // Both named cities the table carries fold onto the tree's single keyword.
    expect(city.areas.map((a) => a.name)).toEqual(['Old Town', 'Sunken Ward'])
  })

  it('joins "Non-City" as the complement of the city maps', () => {
    const brief = strategyBrief(TREE, index, new Set([1, 2, 3, 4, 8, 9, 11, 12]), AREAS, {
      biomeThreshold: 1,
    })
    const wilds = brief.biomes.find((b) => b.keyword === 'Non-City')!
    // Every non-city area qualifies, best-rated first: Bluff and Dunes rate 4,
    // Alpine Keep 3, Bog 2.
    expect(wilds.areas.map((a) => a.name)).toEqual(['Bluff', 'Dunes', 'Alpine Keep', 'Bog'])
  })

  it('keeps a single biome node quiet — one rider is not a strategy', () => {
    const brief = strategyBrief(TREE, index, new Set([1, 2, 3, 4, 10]), AREAS)
    expect(brief.biomes).toEqual([])
  })
})

describe('strategyBrief keystones', () => {
  it('lists the allocated keystones in mechanic rank order', () => {
    const brief = strategyBrief(TREE, index, ALLOCATED, AREAS)
    expect(brief.keystones.map((k) => k.name)).toEqual(['Chain Shape'])
    expect(brief.keystones[0]).toMatchObject({ subtree: 'Breach', color: '#ff00ff' })
  })
})

describe('atlasBiomeKey non-city', () => {
  it('passes the bucket keyword through unchanged', () => {
    expect(atlasBiomeKey('Non-City')).toBe('Non-City')
  })
})
