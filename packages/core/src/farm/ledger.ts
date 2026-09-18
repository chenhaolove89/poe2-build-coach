/**
 * The money side of a farming session.
 *
 * Nothing in the log says what dropped, so this is a book the player keeps by
 * hand: they Ctrl+C an item, the app prices it, and it lands here. Costs work
 * the same way — a waystone ticket is just an item you paste and book as a cost.
 *
 * Amounts stay in the currency the trade site quoted them in. Converting would
 * mean carrying an exchange rate that goes stale between patches, and a wrong
 * rate is worse than a book that admits it has two currencies in it.
 */

export interface LedgerEntry {
  id: string
  at: number
  /** What the player will recognise later: the item's name or base type. */
  label: string
  amount: number
  currency: string
  kind: 'income' | 'cost'
}

export interface LedgerSummary {
  /** The currency the totals are in, or null when the book is empty. */
  currency: string | null
  income: number
  cost: number
  net: number
  /** Net per wall-clock hour of the session. */
  netPerHour: number
  entries: number
  /** Currencies other than {@link currency}, kept visible rather than converted. */
  others: { currency: string; count: number }[]
}

/**
 * Total the book in its most-used currency.
 *
 * `windowMs` is the session length the per-hour figure is divided by. It is
 * passed in rather than stored because the session is still running when this is
 * called — the clock lives with the caller.
 */
export function summariseLedger(entries: readonly LedgerEntry[], windowMs: number): LedgerSummary {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.currency, (counts.get(entry.currency) ?? 0) + 1)

  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  let income = 0
  let cost = 0
  for (const entry of entries) {
    if (entry.currency !== currency) continue
    if (entry.kind === 'income') income += entry.amount
    else cost += entry.amount
  }

  const net = income - cost
  const hours = windowMs / 3_600_000
  return {
    currency,
    income,
    cost,
    net,
    netPerHour: hours > 0 ? net / hours : 0,
    entries: entries.length,
    others: [...counts.entries()]
      .filter(([c]) => c !== currency)
      .map(([c, count]) => ({ currency: c, count }))
      .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency)),
  }
}
