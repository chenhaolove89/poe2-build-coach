/**
 * Which map is worth running — answered from the player's own runs.
 *
 * A community tier list cannot answer this for PoE2. There is no authoritative map
 * layout ranking, and no credible per-hour figure for any farming strategy (the
 * research behind this module found Maxroll's tier list gives letter grades and no
 * numbers, and the only figures with digits come from an unmaintained one-person
 * repo). What *is* knowable is what this player's runs earned, and the app already
 * records both halves of that: the log's timeline and the ledger's money.
 *
 * So this module joins the two to the area table by area code and groups by map.
 * It reports measurements, not advice, and it refuses to flatter them:
 *
 *   - a map run once is a sample of one, so `runs` travels with every figure;
 *   - a map whose drops could not be priced did not earn zero, so `unpriced` counts
 *     what the rates could not convert;
 *   - a run whose area code is not in the table is kept and flagged `known: false`
 *     rather than dropped, which is how the table gets found wanting;
 *   - the same map run at different monster levels is averaged together here, so
 *     `levels` is reported to make that visible rather than hidden.
 */
import { incomePerMap } from './series.js'
import type { RateTable } from './series.js'
import { visitMs, visitNetMs } from './session.js'
import type { AreaVisit } from './session.js'
import type { LedgerEntry } from './ledger.js'
import { findAreaByCode } from '../maps/areas.js'
import type { AreaIndex, MapArea, MapKind, MapLayout } from '../maps/areas.js'

export interface MapRunSummary {
  /** The log's area code, or null when the visit never carried one. */
  code: string | null
  /** The table's English name when the code is known, otherwise what the client called it. */
  name: string
  /**
   * What the player's own client called the area. Kept alongside `name` because the
   * two genuinely differ: the name dictionary renders `Deforestation` as 伐林地 while
   * a 国服 client shows 毁坏的林场, and the player recognises the one they saw.
   */
  clientName: string
  /** False when the code was not in the table — the run is kept and flagged. */
  known: boolean
  kind: MapKind | null
  layout: MapLayout | null
  biomes: string[]
  /** Distinct monster levels seen, ascending. Empty when the log never said. */
  levels: number[]
  runs: number
  /** Wall-clock time across runs, loading screens included. */
  totalMs: number
  /** Wall-clock time minus loading screens. */
  netMs: number
  loadingMs: number
  /** Net income in the reference currency, priced entries only. */
  net: number
  /** Entries attributed to these runs that no rate could price. */
  unpriced: number
  /** Mean net per run; null when there were no runs. */
  perRun: number | null
  /** Net per hour of *played* time (loading excluded); null when no time was recorded. */
  perHour: number | null
}

interface Accumulator {
  code: string | null
  clientName: string
  area: MapArea | undefined
  runs: number
  totalMs: number
  netMs: number
  loadingMs: number
  net: number
  unpriced: number
  levels: Set<number>
}

/**
 * Group a session's map runs by the map they were.
 *
 * Sorted by total net income, so the map that produced the most sits first — that
 * is "where the money came from", which is the question the page is answering. A
 * caller that wants per-run or per-hour ordering re-sorts; both are on every row.
 *
 * `now` is only read for a visit that is still open, matching `summariseSession`.
 */
export function summariseRunsByMap(
  visits: readonly AreaVisit[],
  entries: readonly LedgerEntry[],
  rates: RateTable,
  index: AreaIndex,
  now: number,
): MapRunSummary[] {
  const mapVisits = visits.filter((v) => v.kind === 'map')
  // incomePerMap walks the same filtered list in the same order, so the i-th income
  // row belongs to the i-th map visit. Zipping reuses its window rule — a map owns
  // everything up to the next map's start, so the hideout sales of what it dropped
  // count as its own — rather than restating a rule subtle enough to drift.
  const incomes = incomePerMap(visits, entries, rates)

  const groups = new Map<string, Accumulator>()
  mapVisits.forEach((visit, i) => {
    const income = incomes[i]
    const key = visit.code ?? `client:${visit.name}`
    let acc = groups.get(key)
    if (!acc) {
      acc = {
        code: visit.code,
        clientName: visit.name,
        area: findAreaByCode(index, visit.code),
        runs: 0,
        totalMs: 0,
        netMs: 0,
        loadingMs: 0,
        net: 0,
        unpriced: 0,
        levels: new Set<number>(),
      }
      groups.set(key, acc)
    }
    acc.runs++
    acc.totalMs += visitMs(visit, now)
    acc.netMs += visitNetMs(visit, now)
    acc.loadingMs += visit.loadingMs
    acc.net += income?.net ?? 0
    acc.unpriced += income?.unpricedCount ?? 0
    if (visit.level != null) acc.levels.add(visit.level)
  })

  return [...groups.values()]
    .map((acc): MapRunSummary => {
      const hours = acc.netMs / 3_600_000
      return {
        code: acc.code,
        name: acc.area?.name ?? acc.clientName,
        clientName: acc.clientName,
        known: acc.area != null,
        kind: acc.area?.kind ?? null,
        layout: acc.area?.layout ?? null,
        biomes: acc.area?.biomes ?? [],
        levels: [...acc.levels].sort((a, b) => a - b),
        runs: acc.runs,
        totalMs: acc.totalMs,
        netMs: acc.netMs,
        loadingMs: acc.loadingMs,
        net: acc.net,
        unpriced: acc.unpriced,
        perRun: acc.runs > 0 ? acc.net / acc.runs : null,
        perHour: hours > 0 ? acc.net / hours : null,
      }
    })
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name))
}
