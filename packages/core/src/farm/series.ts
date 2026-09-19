/**
 * Turning the ledger into numbers a chart can draw.
 *
 * The ledger is honest about being multi-currency — a session's income lands in
 * whatever the drops and the trades were denominated in — but a curve needs one
 * unit. The conversion is caller-supplied (`RateTable`), because rates are a
 * *fetched* fact with a shelf life, and this module stays pure: give it a table
 * and it converts, give it an empty table and everything unpriced is reported
 * rather than guessed.
 *
 * The reference currency is divine: it is what a farming session's value is
 * measured in by convention.
 */
import type { LedgerEntry } from './ledger.js'
import type { AreaVisit } from './session.js'

/** How much one unit of a currency is worth, in the reference currency. */
export type RateTable = Readonly<Record<string, number>>

export const REFERENCE_CURRENCY = 'divine'

/**
 * The entry's signed value in the reference currency.
 *
 * Null means "no rate covers this currency" — the caller is expected to report
 * that entry as unpriced rather than drop it silently, because a curve that
 * quietly ignores half the ledger invents a profit picture.
 */
export function ledgerValueIn(
  entry: LedgerEntry,
  rates: RateTable,
  reference: string = REFERENCE_CURRENCY,
): number | null {
  const signed = entry.kind === 'income' ? entry.amount : -entry.amount
  if (entry.currency === reference) return signed
  const rate = rates[entry.currency]
  return rate != null && Number.isFinite(rate) ? signed * rate : null
}

/** One point of the cumulative net-income curve. */
export interface CurvePoint {
  at: number
  /** Net value in the reference currency, from the session's start to `at`. */
  net: number
}

/**
 * The cumulative net-income curve across a session.
 *
 * Starts flat at zero for `startAt`, jumps (or dips) at every priced entry in
 * order, and ends with a point at `endAt` so a session that ended quiet still
 * reads as a flat tail rather than a line that stops at the last event. Entries
 * without a rate are skipped here; `unpricedTotals` is how the caller reports
 * them. An entry earlier than `startAt` still counts — a player who books a
 * drop and presses start a second later should not lose it to a clock race.
 */
export function cumulativeNetSeries(
  entries: readonly LedgerEntry[],
  rates: RateTable,
  startAt: number,
  endAt: number,
): CurvePoint[] {
  let pre = 0
  let last = startAt
  let net = 0
  const later: CurvePoint[] = []
  const ordered = [...entries].sort((a, b) => a.at - b.at)
  for (const entry of ordered) {
    const value = ledgerValueIn(entry, rates)
    if (value == null) continue
    last = Math.max(last, entry.at)
    if (entry.at > startAt) {
      net += value
      later.push({ at: entry.at, net })
    } else {
      pre += value
    }
  }
  const points: CurvePoint[] = [{ at: startAt, net: pre }]
  points.push(...later)
  // The tail carries the session's full total, pre-start bookkeeping included.
  if (endAt > last) points.push({ at: endAt, net: pre + net })
  return points
}

/**
 * What the ledger carried that the rates could not price, grouped by currency.
 * Amounts are summed unsigned — this is a "what is missing" report, not a
 * balance.
 */
export function unpricedTotals(
  entries: readonly LedgerEntry[],
  rates: RateTable,
  reference: string = REFERENCE_CURRENCY,
): { currency: string; count: number }[] {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    if (ledgerValueIn(entry, rates, reference) != null) continue
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amount)
  }
  return [...totals.entries()]
    .map(([currency, count]) => ({ currency, count }))
    .sort((a, b) => b.count - a.count)
}

/** One map's attributed income, for the per-map bars. */
export interface MapIncome {
  name: string
  code: string | null
  startAt: number
  endAt: number | null
  /** Net in the reference currency, priced entries only. */
  net: number
  /** How many ledger entries landed in the window. */
  entryCount: number
}

/**
 * Attribute ledger entries to the map runs that produced them.
 *
 * A map's window runs from its own start to the *next map's* start, not to its
 * own end: the sales of what a map dropped usually happen in the hideout after
 * it, and attributing them to the map that produced the goods is the reading a
 * farmer wants — so the last map runs to the session's end. Entries before the
 * first map (early costs, usually) belong to no run and are left out here; the
 * curve still counts them.
 */
export function incomePerMap(
  visits: readonly AreaVisit[],
  entries: readonly LedgerEntry[],
  rates: RateTable,
): MapIncome[] {
  const maps = visits.filter((v) => v.kind === 'map')
  return maps.map((visit, i) => {
    const upper = maps[i + 1]?.startAt ?? Number.POSITIVE_INFINITY
    let net = 0
    let entryCount = 0
    for (const entry of entries) {
      if (entry.at < visit.startAt || entry.at >= upper) continue
      const value = ledgerValueIn(entry, rates)
      if (value == null) continue
      net += value
      entryCount++
    }
    return { name: visit.name, code: visit.code, startAt: visit.startAt, endAt: visit.endAt, net, entryCount }
  })
}
