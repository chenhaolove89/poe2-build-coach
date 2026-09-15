/** One priced listing, flattened from the trade site's fetch payload. */
export interface PriceListing {
  amount: number
  currency: string
  name: string | null
  typeLine: string | null
  itemLevel: number | null
  modCount: number
  corrupted: boolean
  account: string | null
}

export interface PriceSummary {
  listings: PriceListing[]
  /** Listings that carried a price tag. */
  priced: number
  /** Listings the seller left without a price (DND/offer-only). */
  unpriced: number
  /** Currency most listings are priced in; stats below refer to it. */
  currency: string | null
  min: number | null
  median: number | null
  max: number | null
  /** Every currency seen, so mixed results are visible rather than hidden. */
  byCurrency: { currency: string; count: number }[]
}

interface RawListing {
  listing?: {
    price?: { amount?: number; currency?: string } | null
    account?: { name?: string } | null
  } | null
  item?: {
    name?: string
    typeLine?: string
    ilvl?: number
    corrupted?: boolean
    explicitMods?: unknown[]
  } | null
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Reduce a `/api/trade2/fetch` response to numbers a player can act on.
 *
 * Listings disagree on currency, so the statistics describe the most common
 * one; the rest stay visible in `byCurrency` instead of being silently
 * converted at a rate we would have to keep fresh.
 */
export function summarisePrices(payload: unknown, limit = 10): PriceSummary {
  const raw = ((payload as { result?: RawListing[] } | null)?.result ?? []) as RawListing[]
  const listings: PriceListing[] = []
  const currencyCounts = new Map<string, number>()
  let unpriced = 0

  for (const entry of raw.slice(0, limit)) {
    const price = entry.listing?.price
    if (!price || typeof price.amount !== 'number' || !price.currency) {
      unpriced++
      continue
    }
    currencyCounts.set(price.currency, (currencyCounts.get(price.currency) ?? 0) + 1)
    listings.push({
      amount: price.amount,
      currency: price.currency,
      name: entry.item?.name ?? null,
      typeLine: entry.item?.typeLine ?? null,
      itemLevel: entry.item?.ilvl ?? null,
      modCount: Array.isArray(entry.item?.explicitMods) ? entry.item!.explicitMods!.length : 0,
      corrupted: Boolean(entry.item?.corrupted),
      account: entry.listing?.account?.name ?? null,
    })
  }

  const byCurrency = [...currencyCounts.entries()]
    .map(([currency, count]) => ({ currency, count }))
    .sort((a, b) => b.count - a.count)

  const currency = byCurrency[0]?.currency ?? null
  const amounts = listings
    .filter((l) => l.currency === currency)
    .map((l) => l.amount)
    .sort((a, b) => a - b)

  return {
    listings,
    priced: listings.length,
    unpriced,
    currency,
    min: amounts.length ? amounts[0] : null,
    median: median(amounts),
    max: amounts.length ? amounts[amounts.length - 1] : null,
    byCurrency,
  }
}
