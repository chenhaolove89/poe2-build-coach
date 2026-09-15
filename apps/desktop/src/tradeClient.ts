import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import {
  buildItemQuery,
  buildStatIndex,
  matchItemMods,
  shouldRetryOffline,
  summarisePrices,
} from '@poe2coach/core'
import type { BuiltQuery, GameItem, PriceSummary, StatIndex, StatIndexEntry, StatMatch } from '@poe2coach/core'
import tradeStatsJson from '@poe2coach/data/trade-stats.json'

const API = 'https://www.pathofexile.com/api/trade2'
const UA = 'poe2-build-coach (desktop; github.com/chenhaolove89/poe2-build-coach)'

let statIndex: StatIndex | null = null
/** Built once from the 7965-entry pack; the lookup itself is a Map hit. */
export function getStatIndex(): StatIndex {
  if (!statIndex) statIndex = buildStatIndex((tradeStatsJson as unknown as { stats: StatIndexEntry[] }).stats)
  return statIndex
}

/** True inside the Tauri webview, where requests bypass the browser's CORS rules. */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * The trade API allows 5 requests / 10s, 15 / 60s, 30 / 300s per IP. A single
 * price check costs two requests, so keep a conservative client-side budget and
 * refuse rather than burn the allowance on a burst.
 */
const WINDOWS: { ms: number; max: number }[] = [
  { ms: 10_000, max: 4 },
  { ms: 60_000, max: 12 },
  { ms: 300_000, max: 25 },
]
const requestLog: number[] = []

export interface RateLimitState {
  usedInWindow: number
  windowSeconds: number
  maxInWindow: number
  /** Milliseconds to wait before the next request is allowed. */
  retryInMs: number
}

export function rateLimitState(now = Date.now()): RateLimitState {
  while (requestLog.length > 0 && now - requestLog[0] > WINDOWS[1].ms) requestLog.shift()
  for (const window of WINDOWS) {
    const used = requestLog.filter((t) => now - t <= window.ms).length
    if (used >= window.max) {
      const oldest = requestLog.filter((t) => now - t <= window.ms)[0]
      return {
        usedInWindow: used,
        windowSeconds: window.ms / 1000,
        maxInWindow: window.max,
        retryInMs: oldest + window.ms - now,
      }
    }
  }
  return { usedInWindow: requestLog.length, windowSeconds: WINDOWS[0].ms / 1000, maxInWindow: WINDOWS[0].max, retryInMs: 0 }
}

export class TradeError extends Error {
  readonly code: string
  constructor(message: string, code = 'trade_error') {
    super(message)
    this.name = 'TradeError'
    this.code = code
  }
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  if (!isDesktopRuntime()) {
    throw new TradeError('浏览器预览无法直连官方 API(跨域被拦),请使用桌面版。', 'needs_desktop')
  }
  const limit = rateLimitState()
  if (limit.retryInMs > 0) {
    throw new TradeError(
      `请求过于频繁,请等 ${Math.ceil(limit.retryInMs / 1000)} 秒(官方限流 ${limit.maxInWindow} 次 / ${limit.windowSeconds} 秒)。`,
      'rate_limited',
    )
  }
  requestLog.push(Date.now())
  const res = await tauriFetch(`${API}${path}`, {
    ...init,
    headers: { 'user-agent': UA, ...(init?.headers ?? {}) },
  })
  if (res.status === 429) {
    throw new TradeError('官方接口返回 429(超过速率限制),请稍后重试。', 'rate_limited')
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok) {
    throw new TradeError(body?.error?.message ?? `官方接口错误(HTTP ${res.status})`, `http_${res.status}`)
  }
  return body
}

/** Current challenge league first, so the default is what people actually play. */
export async function fetchLeagues(): Promise<string[]> {
  const body = (await apiFetch('/data/leagues')) as { result?: { id: string; realm?: string }[] }
  const ids = (body.result ?? []).map((l) => l.id)
  const preferred = ids.filter((id) => !/^(HC |Hardcore|Standard)/.test(id))
  return [...preferred, ...ids.filter((id) => !preferred.includes(id))]
}

export interface PriceCheckResult {
  matches: StatMatch[]
  built: BuiltQuery
  summary: PriceSummary
  /** How many listings the search matched in total (not just the fetched page). */
  total: number
  league: string
  /**
   * True when the online-only search found nothing and the result came from a
   * second query that also allows sellers who are offline.
   */
  relaxed: boolean
}

/** Fetch could return a page of ids; ten is the trade site's own preview size. */
const FETCH_BATCH = 10

/**
 * Price a parsed item: match its mods to official stat ids, search, then fetch
 * the first page of listings.
 *
 * When a name search comes back empty, the query is repeated with offline
 * sellers allowed, because that is where a chase unique's listings live.
 */
export async function priceCheck(
  item: GameItem,
  options: { league: string; maxFilters?: number; online?: boolean },
): Promise<PriceCheckResult> {
  const onlineOnly = options.online !== false
  const matches = matchItemMods(item, getStatIndex())

  async function run(online: boolean): Promise<{ built: BuiltQuery; summary: PriceSummary; total: number }> {
    const built = buildItemQuery(item, matches, { maxFilters: options.maxFilters, online })
    if (!built.tradeQuery.query.type && !built.tradeQuery.query.name) {
      throw new TradeError('这件物品没有可查询的基底名,无法查价。', 'no_base_type')
    }

    const search = (await apiFetch(`/search/poe2/${encodeURIComponent(options.league)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(built.tradeQuery),
    })) as { id?: string; result?: string[]; total?: number; error?: { message?: string } }
    if (search.error) throw new TradeError(search.error.message ?? '查询被拒绝', 'query_rejected')

    const ids = (search.result ?? []).slice(0, FETCH_BATCH)
    const total = search.total ?? 0
    const payload =
      ids.length > 0 && search.id ? await apiFetch(`/fetch/${ids.join(',')}?query=${search.id}`) : { result: [] }
    return { built, summary: summarisePrices(payload, FETCH_BATCH), total }
  }

  let outcome = await run(onlineOnly)
  let relaxed = false
  const byName = Boolean(outcome.built.tradeQuery.query.name)
  if (shouldRetryOffline({ onlineOnly, byName, total: outcome.total })) {
    const offline = await run(false)
    if (offline.total > 0) {
      outcome = offline
      relaxed = true
    }
  }
  return { matches, ...outcome, league: options.league, relaxed }
}

const LEAGUE_KEY = 'poe2coach.tradeLeague'

export function savedLeague(): string | null {
  try {
    return localStorage.getItem(LEAGUE_KEY)
  } catch {
    return null
  }
}

export function rememberLeague(league: string): void {
  try {
    localStorage.setItem(LEAGUE_KEY, league)
  } catch {
    /* storage disabled — the pick just will not persist */
  }
}
