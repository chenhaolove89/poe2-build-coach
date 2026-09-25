/**
 * Exchange rates for turning a mixed-currency ledger into one reference unit.
 *
 * The official bulk-exchange endpoint answers "what do divine cost, paid in X"
 * for any realm that runs the trade2 API, and the median listing is the rate.
 * That is a *fetched* fact with a shelf life: rates are cached for ten minutes
 * per realm+league+currency and re-fetched after that, and a pair that cannot
 * be fetched (the CN endpoint may differ, the player may be offline) is
 * reported as missing rather than guessed — the charts show what the rates
 * cover and say what they do not.
 *
 * The requests go through `apiFetch`, so they share the trade page's rate
 * limit and its realm selection.
 */
import { REFERENCE_CURRENCY, type RateTable } from '@poe2coach/core'
import { apiFetch, TradeError } from './tradeClient'
import { realmId } from './settings'

/** Median is the honest summary of a listing spread full of outliers. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface CachedRate {
  divinePerUnit: number
  at: number
}

const TTL_MS = 10 * 60_000
const cache = new Map<string, CachedRate>()

/** The league the current ensureRates call works in, part of the cache key. */
let currentLeague = ''

interface ExchangeListing {
  listing?: {
    offers?: {
      exchange?: { currency?: string; amount?: number }
      item?: { currency?: string; amount?: number }
    }[]
  }
}

/** Divine per unit of `currency`, from the live exchange, or null. */
async function fetchRate(currency: string, league: string): Promise<number | null> {
  const body = (await apiFetch(`/exchange/${encodeURIComponent(league)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exchange: { want: [REFERENCE_CURRENCY], have: [currency], status: { option: 'online' } },
    }),
  })) as { result?: Record<string, ExchangeListing> }

  const listings = Object.values(body.result ?? {})
  const ratios: number[] = []
  for (const entry of listings) {
    const offer = entry.listing?.offers?.[0]
    const paid = offer?.exchange
    const got = offer?.item
    if (paid?.currency !== currency || got?.currency !== REFERENCE_CURRENCY) continue
    if (!paid.amount || !got.amount || paid.amount <= 0 || got.amount <= 0) continue
    ratios.push(got.amount / paid.amount)
  }
  return median(ratios)
}

export interface RatesResult {
  rates: RateTable
  /** Currencies asked for but not covered: no listing, or the fetch failed. */
  missing: string[]
}

/**
 * Rates for every currency in `currencies` (the reference itself needs none).
 * Fresh cache entries are reused; the rest are fetched one by one — the shared
 * rate limit makes parallel bursts self-defeating.
 */
export async function ensureRates(currencies: string[], league: string): Promise<RatesResult> {
  currentLeague = league
  const now = Date.now()
  const rates: Record<string, number> = {}
  const missing: string[] = []
  for (const currency of currencies) {
    if (currency === REFERENCE_CURRENCY) continue
    const hit = cache.get(`${realmId.value}|${currentLeague}|${currency}`)
    if (hit && now - hit.at < TTL_MS) {
      rates[currency] = hit.divinePerUnit
      continue
    }
    try {
      const value = await fetchRate(currency, league)
      if (value != null && Number.isFinite(value) && value > 0) {
        cache.set(`${realmId.value}|${currentLeague}|${currency}`, { divinePerUnit: value, at: now })
        rates[currency] = value
      } else {
        missing.push(currency)
      }
    } catch (e) {
      // The CN endpoint may simply not exist, or the player is not logged in;
      // only a shared rate-limit hit is worth throwing, because it also
      // threatens the price checks the player makes next.
      if (e instanceof TradeError && e.code === 'rate_limited') throw e
      missing.push(currency)
    }
  }
  return { rates, missing }
}
