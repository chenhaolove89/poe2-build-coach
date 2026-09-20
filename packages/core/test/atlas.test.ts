import { describe, expect, it } from 'vitest'
import {
  allocatedEffects,
  atlasBiomeKey,
  atlasNodesForBiome,
  atlasStatText,
  buildAtlasIndex,
  canAllocate,
  isAllocatable,
  pathTo,
  subtreeProgress,
  unallocate,
  validateAllocation,
  type AtlasNode,
  type AtlasTree,
} from '../src/atlas/tree.js'

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

// Two subtrees: A is a root plus a chain, B is a root plus a mastery slot, and 99
// hangs off nothing at all.
const NODES: AtlasNode[] = [
  node({ hash: 1, name: 'A root', kind: 'root', subtree: 'Breach', root: true, stats: ['[ContainsBreach|Breaches] contain 5% more monsters'] }),
  node({ hash: 2, name: 'A mid', subtree: 'Breach' }),
  node({ hash: 3, name: 'A notable', kind: 'notable', subtree: 'Breach', stats: ['10% increased [ItemRarity|Rarity]'], biomes: ['Mountain'] }),
  node({ hash: 10, name: 'B root', kind: 'root', subtree: 'Ritual', root: true }),
  node({ hash: 11, name: 'B mid', subtree: 'Ritual' }),
  node({ hash: 12, name: 'B mastery', kind: 'mastery', subtree: 'Ritual' }),
  node({ hash: 99, name: 'Orphan', subtree: 'Delirium' }),
]

const TREE: AtlasTree = {
  source: 'test',
  captured: '2026-09-20',
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  biomeKeywords: ['Mountain', 'City'],
  subtrees: [
    { id: 'main', label: '主树', color: '#888', root: null, count: 0, notables: 0 },
    { id: 'Breach', label: '裂隙', color: '#f0f', root: 1, count: 3, notables: 1 },
    { id: 'Ritual', label: '祭祀', color: '#0ff', root: 10, count: 3, notables: 0 },
    { id: 'Delirium', label: '迷雾', color: '#ff0', root: null, count: 1, notables: 0 },
  ],
  nodes: NODES,
  edges: [
    [1, 2],
    [2, 3],
    [10, 11],
    [11, 12],
  ],
}

const index = buildAtlasIndex(TREE)
const none: ReadonlySet<number> = new Set()

describe('atlasStatText', () => {
  it('keeps the display half of a keyword reference', () => {
    expect(atlasStatText('10% increased [ItemRarity|Rarity]')).toBe('10% increased Rarity')
    expect(atlasStatText('[ContainsExpedition|Expeditions] contain more')).toBe('Expeditions contain more')
  })

  it('splits a bare id as a visible fallback rather than dropping it', () => {
    expect(atlasStatText('affects [Rarity]')).toBe('affects Rarity')
    expect(atlasStatText('affects [ContainsDelirium]')).toBe('affects Contains Delirium')
  })

  it('resolves several references in one line', () => {
    expect(
      atlasStatText('[AzmeriSpirit|Azmeri Spirits] may [SpiritPossessed|Possess] [Strongbox|Strongboxes]'),
    ).toBe('Azmeri Spirits may Possess Strongboxes')
  })

  it('leaves plain text alone', () => {
    expect(atlasStatText('Boots may be found as Exceptional Items')).toBe('Boots may be found as Exceptional Items')
  })
})

describe('buildAtlasIndex', () => {
  it('indexes by hash and by subtree', () => {
    expect(index.byHash.get(3)?.name).toBe('A notable')
    expect(index.bySubtree.get('Breach')?.map((n) => n.hash)).toEqual([1, 2, 3])
  })

  it('makes adjacency undirected, so a walk does not depend on which end lists the link', () => {
    expect(index.neighbours.get(1)).toEqual([2])
    expect(index.neighbours.get(2)?.sort()).toEqual([1, 3])
  })
})

describe('isAllocatable', () => {
  it('refuses the icon-only mastery slots', () => {
    expect(isAllocatable(index.byHash.get(12)!)).toBe(false)
    expect(isAllocatable(index.byHash.get(3)!)).toBe(true)
  })
})

describe('canAllocate', () => {
  it('lets an entry point be taken first', () => {
    expect(canAllocate(index, none, 1)).toBe(true)
    expect(canAllocate(index, none, 10)).toBe(true)
  })

  it('refuses a node with nothing allocated beside it', () => {
    expect(canAllocate(index, none, 2)).toBe(false)
    expect(canAllocate(index, none, 3)).toBe(false)
  })

  it('allows a node touching an allocated one', () => {
    expect(canAllocate(index, new Set([1]), 2)).toBe(true)
  })

  it('refuses what is already allocated', () => {
    expect(canAllocate(index, new Set([1]), 1)).toBe(false)
  })

  it('refuses a mastery slot even when it is adjacent', () => {
    expect(canAllocate(index, new Set([10, 11]), 12)).toBe(false)
  })
})

describe('pathTo', () => {
  it('returns nothing for an already-allocated node', () => {
    expect(pathTo(index, new Set([1, 2]), 2)).toEqual([])
  })

  it('walks the shortest chain from an entry point', () => {
    expect(pathTo(index, none, 3)).toEqual([1, 2, 3])
  })

  it('continues from what is already allocated', () => {
    expect(pathTo(index, new Set([1, 2]), 3)).toEqual([3])
  })

  it('returns null when no entry point can reach the node', () => {
    // 99 hangs off nothing, and Delirium has no root in this fixture.
    expect(pathTo(index, none, 99)).toBeNull()
  })

  it('returns null for a mastery slot', () => {
    expect(pathTo(index, new Set([10, 11]), 12)).toBeNull()
  })

  it('reaches the other subtree only after its own entry point is taken', () => {
    expect(pathTo(index, new Set([1]), 10)).toEqual([10])
  })
})

describe('validateAllocation', () => {
  it('accepts a chain grown from an entry point', () => {
    expect(validateAllocation(index, new Set([1, 2, 3]))).toEqual({ ok: true, orphans: [] })
  })

  it('accepts entry points standing alone', () => {
    expect(validateAllocation(index, new Set([1, 10])).ok).toBe(true)
  })

  it('flags a node with no allocated neighbour', () => {
    const check = validateAllocation(index, new Set([1, 3]))
    expect(check.ok).toBe(false)
    expect(check.orphans).toEqual([3])
  })

  it('flags a hash the tree does not carry', () => {
    expect(validateAllocation(index, new Set([4242])).orphans).toEqual([4242])
  })
})

describe('subtreeProgress', () => {
  it('counts allocation and notables per subtree', () => {
    const progress = subtreeProgress(index, TREE, new Set([1, 2, 3]))
    const breach = progress.find((p) => p.id === 'Breach')!
    expect(breach.allocated).toBe(3)
    expect(breach.total).toBe(3)
    expect(breach.notablesTaken).toBe(1)
    expect(breach.notablesTotal).toBe(1)
    expect(breach.unlocked).toBe(true)
  })

  it('reports an untouched subtree as locked when it has no reachable node', () => {
    const progress = subtreeProgress(index, TREE, new Set([1]))
    const delirium = progress.find((p) => p.id === 'Delirium')!
    expect(delirium.allocated).toBe(0)
    expect(delirium.unlocked).toBe(false)
  })

  it('leaves mastery slots out of the totals, since no point can go into one', () => {
    const ritual = subtreeProgress(index, TREE, none).find((p) => p.id === 'Ritual')!
    expect(ritual.total).toBe(2)
  })
})

describe('allocatedEffects', () => {
  it('groups the granted effect lines by subtree, in display form', () => {
    const effects = allocatedEffects(index, new Set([1, 3]))
    const breach = effects.find((e) => e.subtree === 'Breach')!
    expect(breach.lines).toEqual([
      'Breaches contain 5% more monsters',
      '10% increased Rarity',
    ])
  })

  it('skips nodes with no effect text', () => {
    expect(allocatedEffects(index, new Set([2]))).toEqual([])
  })
})

describe('unallocate', () => {
  it('takes the chain beyond the removed node with it', () => {
    // Dropping 1 would leave 2 and 3 stranded, which the game would not allow.
    expect([...unallocate(index, new Set([1, 2, 3]), 1)].sort()).toEqual([])
  })

  it('keeps what still reaches an entry point', () => {
    expect([...unallocate(index, new Set([1, 2, 3]), 3)].sort()).toEqual([1, 2])
  })

  it('leaves a standalone entry point alone', () => {
    expect([...unallocate(index, new Set([1, 10]), 1)].sort()).toEqual([10])
  })

  it('prunes a whole branch back to the fork, not just one level', () => {
    // Removing 2 strands 3, and 3's removal strands nothing more.
    expect([...unallocate(index, new Set([1, 2, 3]), 2)].sort()).toEqual([1])
  })

  it('is a no-op for a node that was not allocated', () => {
    expect([...unallocate(index, new Set([1, 2]), 3)].sort()).toEqual([1, 2])
  })
})

describe('atlasBiomeKey', () => {
  it('folds the three named cities into the single "City" wording the tree uses', () => {
    expect(atlasBiomeKey('Ezomyte City')).toBe('City')
    expect(atlasBiomeKey('Faridun City')).toBe('City')
    expect(atlasBiomeKey('Vaal City')).toBe('City')
  })

  it('passes every other biome through by name', () => {
    expect(atlasBiomeKey('Mountain')).toBe('Mountain')
    expect(atlasBiomeKey('Swamp')).toBe('Swamp')
    expect(atlasBiomeKey('Water')).toBe('Water')
  })
})

describe('atlasNodesForBiome', () => {
  it('finds the nodes the tree restricts to a biome', () => {
    expect(atlasNodesForBiome(index, 'Mountain').map((n) => n.hash)).toEqual([3])
  })

  it('finds nothing for a biome no node names', () => {
    expect(atlasNodesForBiome(index, 'Desert')).toEqual([])
  })
})
