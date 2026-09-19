import { describe, expect, it } from 'vitest'
import {
  cumulativeNetSeries,
  incomePerMap,
  ledgerValueIn,
  unpricedTotals,
  type MapIncome,
} from '../src/farm/series.js'
import type { LedgerEntry } from '../src/farm/ledger.js'
import type { AreaVisit } from '../src/farm/session.js'
import type { RateTable } from '../src/farm/series.js'

const RATES: RateTable = { divine: 1, chaos: 1 / 150, exalted: 1 / 3000 }

function entry(partial: Partial<LedgerEntry> & { at: number }): LedgerEntry {
  return { id: partial.id ?? 'e', label: 'x', amount: 1, currency: 'divine', kind: 'income', ...partial }
}

describe('ledgerValueIn', () => {
  it('passes the reference currency through with its sign', () => {
    expect(ledgerValueIn(entry({ at: 0, amount: 5, kind: 'income' }), RATES)).toBe(5)
    expect(ledgerValueIn(entry({ at: 0, amount: 2, kind: 'cost' }), RATES)).toBe(-2)
  })

  it('converts through the rate table', () => {
    expect(ledgerValueIn(entry({ at: 0, amount: 300, currency: 'chaos' }), RATES)).toBeCloseTo(2)
  })

  it('returns null when no rate covers the currency', () => {
    expect(ledgerValueIn(entry({ at: 0, currency: 'mirror' }), RATES)).toBeNull()
  })
})

describe('cumulativeNetSeries', () => {
  const START = 1_000
  const END = 10_000

  it('is a flat zero line when nothing prices', () => {
    const series = cumulativeNetSeries([entry({ at: 2_000, currency: 'mirror' })], {}, START, END)
    expect(series).toEqual([
      { at: START, net: 0 },
      { at: END, net: 0 },
    ])
  })

  it('walks entries in time order and ends flat at the session end', () => {
    const series = cumulativeNetSeries(
      [
        entry({ at: 5_000, amount: 10 }),
        entry({ at: 3_000, amount: 150, currency: 'chaos' }),
        entry({ at: 7_000, amount: 2, kind: 'cost' }),
        entry({ at: 8_000, currency: 'mirror' }),
      ],
      RATES,
      START,
      END,
    )
    expect(series).toEqual([
      { at: START, net: 0 },
      { at: 3_000, net: 1 },
      { at: 5_000, net: 11 },
      { at: 7_000, net: 9 },
      { at: END, net: 9 },
    ])
  })

  it('keeps an entry booked before the start', () => {
    const series = cumulativeNetSeries([entry({ at: 500, amount: 4 })], RATES, START, END)
    expect(series).toEqual([
      { at: START, net: 4 },
      { at: END, net: 4 },
    ])
  })
})

describe('unpricedTotals', () => {
  it('groups the unpriced amount by currency, unsigned', () => {
    const totals = unpricedTotals(
      [
        entry({ at: 0, amount: 3, currency: 'mirror', kind: 'income' }),
        entry({ at: 0, amount: 2, currency: 'mirror', kind: 'cost' }),
        entry({ at: 0, amount: 5, currency: 'divine' }),
      ],
      RATES,
    )
    expect(totals).toEqual([{ currency: 'mirror', count: 5 }])
  })
})

describe('incomePerMap', () => {
  const START = 1_000
  function visit(partial: Partial<AreaVisit> & { startAt: number; endAt: number | null }): AreaVisit {
    return { code: null, name: 'x', kind: 'map', level: null, loadingMs: 0, ...partial }
  }

  const visits: AreaVisit[] = [
    visit({ startAt: START, endAt: 5_000, name: '林场', code: 'MapA' }),
    visit({ startAt: 6_000, endAt: 9_000, name: '沙地', code: 'MapB' }),
    // Hideout time between and after maps is not a map and owns nothing.
    visit({ startAt: 5_500, endAt: 5_900, name: '藏身处', kind: 'hideout' }),
  ]

  it('attributes a map own entries and the hideout tail after it', () => {
    const incomes = incomePerMap(
      [
        // Out of order on purpose: real logs can interleave the bookkeeping.
        ...visits,
      ],
      [
        entry({ at: 2_000, amount: 3 }),
        // Sold in the hideout after map A, before map B starts.
        entry({ at: 5_700, amount: 2 }),
        // Booked after map B ended — still map B's, its window runs on.
        entry({ at: 9_500, amount: 1 }),
        // Before any map: belongs to no run.
        entry({ at: 500, amount: 1 }),
      ],
      RATES,
    )
    expect(incomes.map((m) => m.net)).toEqual([5, 1])
  })

  it('reports zero for a map with nothing booked', () => {
    const incomes: MapIncome[] = incomePerMap(visits, [], RATES)
    expect(incomes.map((m) => m.entryCount)).toEqual([0, 0])
  })
})
