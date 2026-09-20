import { describe, expect, it } from 'vitest'
import {
  buildAreaIndex,
  findAreaByCode,
  isMapCode,
  farmableAreas,
  type MapArea,
} from '../src/maps/areas.js'
import { summariseRunsByMap } from '../src/farm/perMap.js'
import type { AreaVisit } from '../src/farm/session.js'
import type { LedgerEntry } from '../src/farm/ledger.js'
import type { RateTable } from '../src/farm/series.js'

const RATES: RateTable = { divine: 1, chaos: 1 / 150 }

function area(partial: Partial<MapArea> & { name: string }): MapArea {
  return {
    code: `Map${partial.name.replace(/[^a-z]/gi, '')}`,
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

function visit(partial: Partial<AreaVisit> & { startAt: number; endAt: number | null }): AreaVisit {
  return { code: null, name: 'x', kind: 'map', level: null, loadingMs: 0, ...partial }
}

function entry(partial: Partial<LedgerEntry> & { at: number }): LedgerEntry {
  return { id: partial.id ?? 'e', label: 'x', amount: 1, currency: 'divine', kind: 'income', ...partial }
}

describe('isMapCode', () => {
  it('accepts an atlas map instance', () => {
    expect(isMapCode('MapDeforestation')).toBe(true)
    expect(isMapCode('MapSavanna')).toBe(true)
  })

  it('rejects hideouts and pinnacle arenas, which share the log but not the table', () => {
    expect(isMapCode('HideoutShoreline')).toBe(false)
    expect(isMapCode('Abyss_Pinnacle')).toBe(false)
  })

  it('rejects nothing at all', () => {
    expect(isMapCode(null)).toBe(false)
    expect(isMapCode(undefined)).toBe(false)
    expect(isMapCode('')).toBe(false)
  })
})

describe('buildAreaIndex', () => {
  const areas: MapArea[] = [
    area({ name: 'Deforestation', code: 'MapDeforestation', biomes: ['Forest'] }),
    area({ name: 'Savannah', code: 'MapSavanna', layout: 'open' }),
    // Seven areas really do share this name; a name-keyed table would lose six.
    area({ name: 'Precursor Tower', code: 'MapPrecursorTower', kind: 'tower' }),
    area({ name: 'Precursor Tower', code: 'MapPrecursorTowerDesert', kind: 'tower' }),
    // The wiki lists a name the game data does not carry yet.
    area({ name: 'Gothic City', code: null }),
  ]
  const index = buildAreaIndex(areas)

  it('looks an area up by its code', () => {
    expect(findAreaByCode(index, 'MapSavanna')?.name).toBe('Savannah')
    expect(findAreaByCode(index, 'MapDeforestation')?.biomes).toEqual(['Forest'])
  })

  it('does not derive the code from the name', () => {
    // MapSavanna is "Savannah" -- the convention would have produced MapSavannah.
    expect(findAreaByCode(index, 'MapSavannah')).toBeUndefined()
    expect(findAreaByCode(index, 'MapSavanna')?.name).toBe('Savannah')
  })

  it('returns undefined for an unknown or missing code rather than throwing', () => {
    expect(findAreaByCode(index, 'MapNotInTheTable')).toBeUndefined()
    expect(findAreaByCode(index, null)).toBeUndefined()
  })

  it('keeps every area that shares a name', () => {
    expect(index.byName.get('Precursor Tower')?.map((a) => a.code)).toEqual([
      'MapPrecursorTower',
      'MapPrecursorTowerDesert',
    ])
  })

  it('leaves a code-less row out of the code index but keeps it browsable', () => {
    expect(index.byName.get('Gothic City')).toHaveLength(1)
    expect([...index.byCode.values()].some((a) => a.name === 'Gothic City')).toBe(false)
  })
})

describe('farmableAreas', () => {
  it('keeps only the kind an atlas map rolls into', () => {
    const areas = [
      area({ name: 'Creek' }),
      area({ name: 'Vaults of Kamasa', kind: 'unique' }),
      area({ name: 'Precursor Tower', kind: 'tower' }),
      area({ name: 'The Iron Citadel', kind: 'citadel' }),
    ]
    expect(farmableAreas(areas).map((a) => a.name)).toEqual(['Creek'])
  })
})

describe('summariseRunsByMap', () => {
  const START = 1_000
  const index = buildAreaIndex([
    area({ name: 'Deforestation', code: 'MapDeforestation', layout: 'unknown', biomes: ['Forest'] }),
    area({ name: 'Creek', code: 'MapCreek', layout: 'open', biomes: ['Forest'] }),
  ])

  it('groups repeat runs of one map into a single row', () => {
    const visits = [
      visit({ startAt: START, endAt: START + 60_000, code: 'MapDeforestation', name: '伐林地', level: 79 }),
      visit({ startAt: START + 120_000, endAt: START + 180_000, code: 'MapDeforestation', name: '伐林地', level: 79 }),
    ]
    const rows = summariseRunsByMap(visits, [], RATES, index, START + 200_000)
    expect(rows).toHaveLength(1)
    expect(rows[0].runs).toBe(2)
    expect(rows[0].netMs).toBe(120_000)
  })

  it('names a known map from the table and keeps what the client called it', () => {
    const visits = [visit({ startAt: START, endAt: START + 1_000, code: 'MapDeforestation', name: '伐林地' })]
    const rows = summariseRunsByMap(visits, [], RATES, index, START + 2_000)
    expect(rows[0].name).toBe('Deforestation')
    expect(rows[0].clientName).toBe('伐林地')
    expect(rows[0].known).toBe(true)
    expect(rows[0].biomes).toEqual(['Forest'])
  })

  it('keeps a run whose code is not in the table, flagged rather than dropped', () => {
    const visits = [visit({ startAt: START, endAt: START + 1_000, code: 'MapBrandNew', name: '新图' })]
    const rows = summariseRunsByMap(visits, [], RATES, index, START + 2_000)
    expect(rows).toHaveLength(1)
    expect(rows[0].known).toBe(false)
    expect(rows[0].name).toBe('新图')
    expect(rows[0].layout).toBeNull()
  })

  it('attributes the hideout sale after a map to that map', () => {
    const visits = [
      visit({ startAt: START, endAt: START + 60_000, code: 'MapCreek', name: '小溪' }),
      visit({ startAt: START + 90_000, endAt: START + 150_000, code: 'MapDeforestation', name: '伐林地' }),
    ]
    const rows = summariseRunsByMap(
      visits,
      [
        entry({ at: START + 10_000, amount: 4 }),
        // Sold in the hideout between the two maps: Creek's goods.
        entry({ at: START + 70_000, amount: 3 }),
        entry({ at: START + 100_000, amount: 1 }),
      ],
      RATES,
      index,
      START + 200_000,
    )
    const creek = rows.find((r) => r.code === 'MapCreek')
    const forest = rows.find((r) => r.code === 'MapDeforestation')
    expect(creek?.net).toBe(7)
    expect(forest?.net).toBe(1)
  })

  it('counts what the rates could not price instead of calling it zero', () => {
    const visits = [visit({ startAt: START, endAt: START + 60_000, code: 'MapCreek', name: '小溪' })]
    const rows = summariseRunsByMap(
      visits,
      [entry({ at: START + 1_000, amount: 2 }), entry({ at: START + 2_000, amount: 9, currency: 'mirror' })],
      RATES,
      index,
      START + 100_000,
    )
    expect(rows[0].net).toBe(2)
    expect(rows[0].unpriced).toBe(1)
  })

  it('reports the monster levels seen, so a mixed-tier average is visible', () => {
    const visits = [
      visit({ startAt: START, endAt: START + 1_000, code: 'MapCreek', name: '小溪', level: 80 }),
      visit({ startAt: START + 2_000, endAt: START + 3_000, code: 'MapCreek', name: '小溪', level: 79 }),
      visit({ startAt: START + 4_000, endAt: START + 5_000, code: 'MapCreek', name: '小溪', level: 80 }),
    ]
    const rows = summariseRunsByMap(visits, [], RATES, index, START + 6_000)
    expect(rows[0].levels).toEqual([79, 80])
  })

  it('divides net by runs and by played hours, loading excluded', () => {
    // One 30-minute run with a 5-minute loading screen: half an hour of play.
    const visits = [
      visit({
        startAt: START,
        endAt: START + 1_800_000,
        loadingMs: 300_000,
        code: 'MapCreek',
        name: '小溪',
      }),
    ]
    const rows = summariseRunsByMap(visits, [entry({ at: START + 1_000, amount: 10 })], RATES, index, START + 2_000_000)
    expect(rows[0].totalMs).toBe(1_800_000)
    expect(rows[0].netMs).toBe(1_500_000)
    expect(rows[0].loadingMs).toBe(300_000)
    expect(rows[0].perRun).toBe(10)
    // 1.5M ms of play = 25 minutes, so 10 divine in 25/60 h = 24 per hour.
    expect(rows[0].perHour).toBeCloseTo(24)
  })

  it('ignores hideout and other visits', () => {
    const visits = [
      visit({ startAt: START, endAt: START + 10_000, name: '藏身处', kind: 'hideout' }),
      visit({ startAt: START + 20_000, endAt: START + 30_000, code: 'MapCreek', name: '小溪' }),
    ]
    const rows = summariseRunsByMap(visits, [], RATES, index, START + 40_000)
    expect(rows.map((r) => r.name)).toEqual(['Creek'])
  })

  it('sorts by total net, so the map the money came from leads', () => {
    const visits = [
      visit({ startAt: START, endAt: START + 60_000, code: 'MapCreek', name: '小溪' }),
      visit({ startAt: START + 90_000, endAt: START + 150_000, code: 'MapDeforestation', name: '伐林地' }),
    ]
    const rows = summariseRunsByMap(
      visits,
      [entry({ at: START + 1_000, amount: 1 }), entry({ at: START + 100_000, amount: 50 })],
      RATES,
      index,
      START + 200_000,
    )
    expect(rows.map((r) => r.name)).toEqual(['Deforestation', 'Creek'])
  })

  it('returns nothing for a session with no map runs', () => {
    expect(summariseRunsByMap([], [], RATES, index, START)).toEqual([])
    expect(
      summariseRunsByMap([visit({ startAt: START, endAt: START + 1, kind: 'hideout', name: '家' })], [], RATES, index, START + 2),
    ).toEqual([])
  })
})
