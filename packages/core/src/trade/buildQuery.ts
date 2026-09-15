import type { GameItem } from '../types.js'
import type { StatMatch } from './matchStats.js'

/** The trade site accepts a bounded number of stat filters per query. */
export const MAX_STAT_FILTERS = 6

export interface TradeQuery {
  query: {
    status: { option: 'online' | 'any' }
    type?: string
    name?: string
    stats: { type: 'and'; filters: { id: string; value: { min: number } }[] }[]
    filters?: { type_filters: { filters: { rarity: { option: string } } } }
  }
  sort: { price: 'asc' }
}

/** Rarity strings the trade site understands, keyed by PoB's uppercase form. */
const TRADE_RARITY: Record<string, string> = {
  UNIQUE: 'unique',
  RARE: 'rare',
  MAGIC: 'magic',
  NORMAL: 'normal',
}

export interface BuiltQuery {
  tradeQuery: TradeQuery
  /** Mods that became filters. */
  used: StatMatch[]
  /** Mods left out (no template match, or beyond the filter budget). */
  skipped: StatMatch[]
}

/**
 * Turn a parsed item plus its matched stats into a trade-site search.
 *
 * Rares are filtered by their mods, with the rolled value as a floor: the
 * question a price check answers is "what do items at least this good cost".
 * Uniques are searched by name only — their price comes from the item itself,
 * and requiring this particular roll finds sellers who do not exist.
 */
export function buildItemQuery(
  item: GameItem,
  matches: StatMatch[],
  options: { online?: boolean; maxFilters?: number } = {},
): BuiltQuery {
  const maxFilters = options.maxFilters ?? MAX_STAT_FILTERS

  const rarity = item.rarity ? TRADE_RARITY[item.rarity.toUpperCase()] : undefined
  const isUnique = rarity === 'unique'

  const usable = isUnique ? [] : matches.filter((m) => m.statId !== null && m.values.length > 0)
  const used = usable.slice(0, maxFilters)
  const skipped = matches.filter((m) => !used.includes(m))

  const query: TradeQuery['query'] = {
    status: { option: options.online === false ? 'any' : 'online' },
    stats: [
      {
        type: 'and',
        filters: used.map((m) => ({ id: m.statId!, value: { min: Math.min(...m.values) } })),
      },
    ],
  }
  if (isUnique && item.name) query.name = item.name
  if (item.base) query.type = item.base
  if (rarity) query.filters = { type_filters: { filters: { rarity: { option: rarity } } } }

  return { tradeQuery: { query, sort: { price: 'asc' } }, used, skipped }
}
