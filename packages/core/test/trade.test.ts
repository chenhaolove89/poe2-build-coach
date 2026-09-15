import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { skeleton, modValues } from '../src/trade/skeleton.js'
import { buildStatIndex, matchItemMods, matchStat } from '../src/trade/matchStats.js'
import { buildItemQuery } from '../src/trade/buildQuery.js'
import { summarisePrices } from '../src/trade/prices.js'
import type { StatIndexEntry } from '../src/trade/matchStats.js'
import type { GameItem } from '../src/types.js'

const PACK = JSON.parse(
  readFileSync(new URL('../../data/trade-stats.json', import.meta.url), 'utf-8'),
) as { stats: StatIndexEntry[] }
const INDEX = buildStatIndex(PACK.stats)

describe('affix skeleton', () => {
  it('reduces a rolled line and its template to the same skeleton', () => {
    // templates, as the official index stores them
    expect(skeleton('# to maximum Life')).toBe(skeleton('+129 to maximum Life'))
    expect(skeleton('#% to Fire Resistance')).toBe(skeleton('+45% to Fire Resistance'))
    expect(skeleton('Adds # to # Physical Damage')).toBe(skeleton('Adds 10 to 20 Physical Damage'))
    expect(skeleton('#% increased Attack Speed')).toBe(skeleton('12% increased Attack Speed'))
  })

  it('keeps values in order and drops the percentage sign', () => {
    expect(modValues('+129 to maximum Life')).toEqual([129])
    expect(modValues('Adds 10 to 20 Physical Damage')).toEqual([10, 20])
    expect(modValues('+45% to Fire Resistance')).toEqual([45])
  })
})

describe('matching item mods against the official index', () => {
  it('resolves common explicit mods to trade stat ids', () => {
    expect(matchStat('+129 to maximum Life', 'explicit', INDEX).statId).toBe('explicit.stat_3299347043')
    expect(matchStat('+45% to Fire Resistance', 'explicit', INDEX).statId).toBe('explicit.stat_3372524247')
    expect(matchStat('+76 to maximum Mana', 'explicit', INDEX).statId).toBe('explicit.stat_1050105434')
  })

  it('leaves lines without a template unmatched instead of guessing', () => {
    expect(matchStat('Corrupted', 'explicit', INDEX).statId).toBeNull()
    expect(matchStat('+12 to a modifier we do not index', 'explicit', INDEX).statId).toBeNull()
  })

  it('prefers the group that matches the mod kind', () => {
    const implicit = matchStat('+12 to maximum Life', 'implicit', INDEX)
    expect(implicit.group).toBe('implicit')
    expect(implicit.statId).toMatch(/^implicit\./)
  })
})

const ITEM: GameItem = {
  rarity: 'RARE',
  name: 'Doom Tread',
  base: 'Runeforged Wanderer Shoes',
  itemClass: 'Boots',
  itemLevel: 82,
  levelReq: null,
  quality: 20,
  corrupted: false,
  armour: null,
  evasion: null,
  energyShield: null,
  ward: null,
  rune: null,
  sockets: null,
  mods: [
    { text: '+129 to maximum Life', kind: 'explicit' },
    { text: '+45% to Fire Resistance', kind: 'explicit' },
    { text: '12% increased Movement Speed', kind: 'explicit' },
    { text: 'Corrupted', kind: 'explicit' },
  ],
  rawText: '',
}

describe('trade query construction', () => {
  it('filters on matched stats and uses the rolled value as a floor', () => {
    const matches = matchItemMods(ITEM, INDEX)
    const { tradeQuery, used, skipped } = buildItemQuery(ITEM, matches)
    expect(tradeQuery.query.type).toBe('Runeforged Wanderer Shoes')
    expect(tradeQuery.query.filters?.type_filters.filters.rarity.option).toBe('rare')
    expect(used.length).toBe(3)
    expect(used[0].values).toEqual([129])
    const filters = tradeQuery.query.stats[0].filters
    expect(filters[0]).toEqual({ id: 'explicit.stat_3299347043', value: { min: 129 } })
    expect(skipped.map((s) => s.text)).toContain('Corrupted')
  })

  it('searches uniques by name without mod filters, and caps the rare filter budget', () => {
    const unique: GameItem = {
      ...ITEM,
      rarity: 'UNIQUE',
      name: 'Headhunter',
      base: 'Heavy Belt',
      mods: Array.from({ length: 9 }, (_, i) => ({ text: `+${i + 10} to maximum Life`, kind: 'explicit' as const })),
    }
    const uniqueBuilt = buildItemQuery(unique, matchItemMods(unique, INDEX))
    expect(uniqueBuilt.tradeQuery.query.name).toBe('Headhunter')
    // A unique's price comes from the item, not this particular roll.
    expect(uniqueBuilt.tradeQuery.query.stats[0].filters).toHaveLength(0)
    expect(uniqueBuilt.skipped).toHaveLength(9)

    const rare: GameItem = {
      ...ITEM,
      mods: Array.from({ length: 9 }, (_, i) => ({ text: `+${i + 10} to maximum Life`, kind: 'explicit' as const })),
    }
    const rareBuilt = buildItemQuery(rare, matchItemMods(rare, INDEX))
    expect(rareBuilt.tradeQuery.query.stats[0].filters).toHaveLength(6)
    expect(rareBuilt.used).toHaveLength(6)
    expect(rareBuilt.skipped).toHaveLength(3)
  })
})

describe('price summarising', () => {
  const payload = {
    result: [
      { listing: { price: { amount: 1, currency: 'regal' }, account: { name: 'a' } }, item: { name: 'Fate Harness', typeLine: 'Heavy Belt', ilvl: 82, explicitMods: [1, 2, 3] } },
      { listing: { price: { amount: 3, currency: 'regal' }, account: { name: 'b' } }, item: { name: 'Healthy Heavy Belt', typeLine: 'Heavy Belt', ilvl: 68, explicitMods: [1] } },
      { listing: { price: { amount: 2, currency: 'exalted' }, account: { name: 'c' } }, item: { name: 'Third', typeLine: 'Heavy Belt', ilvl: 80, explicitMods: [1, 2] } },
      { listing: { price: null, account: { name: 'd' } }, item: { name: 'Unpriced', typeLine: 'Heavy Belt' } },
    ],
  }

  it('summarises the dominant currency and keeps mixed currencies visible', () => {
    const summary = summarisePrices(payload)
    expect(summary.priced).toBe(3)
    expect(summary.unpriced).toBe(1)
    expect(summary.currency).toBe('regal')
    expect(summary.min).toBe(1)
    expect(summary.median).toBe(2)
    expect(summary.max).toBe(3)
    expect(summary.byCurrency).toEqual([
      { currency: 'regal', count: 2 },
      { currency: 'exalted', count: 1 },
    ])
    expect(summary.listings[0].modCount).toBe(3)
  })

  it('survives an empty result', () => {
    const summary = summarisePrices({ result: [] })
    expect(summary.priced).toBe(0)
    expect(summary.median).toBeNull()
    expect(summary.currency).toBeNull()
  })
})
