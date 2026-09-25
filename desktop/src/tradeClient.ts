import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import {
  buildItemQuery,
  buildStatIndex,
  matchItemMods,
  realmOf,
  shouldRetryOffline,
  siteOrigin,
  summarisePrices,
} from '@poe2coach/core'
import type { BuiltQuery, GameItem, PriceSummary, Realm, RealmId, StatIndex, StatIndexEntry, StatMatch } from '@poe2coach/core'
import { cnSession, realm, realmId } from './settings'

const UA = 'poe2-build-coach (desktop; github.com/chenhaolove89/poe2-build-coach)'

/**
 * A stat pack per realm. They are 380-770 KB each and only one is ever needed
 * at a time, so they load on demand through dynamic imports instead of sitting
 * in the startup bundle.
 */
const STAT_PACKS: Record<RealmId, () => Promise<unknown>> = {
  intl: () => import('@poe2coach/data/trade-stats.json'),
  cn: () => import('@poe2coach/data/trade-stats.cn.json'),
  tw: () => import('@poe2coach/data/trade-stats.tw.json'),
}

const CURRENCY_PACKS: Record<RealmId, () => Promise<unknown>> = {
  intl: () => import('@poe2coach/data/trade-currency.json'),
  cn: () => import('@poe2coach/data/trade-currency.cn.json'),
  tw: () => import('@poe2coach/data/trade-currency.tw.json'),
}

/** The realm's mod templates plus its currency labels, once loaded. */
export interface RealmData {
  id: RealmId
  statIndex: StatIndex
  /** Currency id ("exalted") -> the realm's own label (崇高石 / 神聖石). */
  currency: Record<string, string>
}

const loaded = new Map<RealmId, RealmData>()
const loading = new Map<RealmId, Promise<RealmData>>()

/** JSON modules arrive wrapped in `default` when bundled, bare under Node. */
function unwrap<T>(mod: unknown): T {
  const m = mod as { default?: unknown }
  return (m && typeof m === 'object' && 'default' in m ? m.default : mod) as T
}

/** Load the active realm's data, or hand back what is already in memory. */
export function ensureRealmData(id: RealmId = realmId.value): Promise<RealmData> {
  const cached = loaded.get(id)
  if (cached) return Promise.resolve(cached)
  const inFlight = loading.get(id)
  if (inFlight) return inFlight

  const task = (async () => {
    const [statsMod, currencyMod] = await Promise.all([STAT_PACKS[id](), CURRENCY_PACKS[id]()])
    const stats = unwrap<{ stats: StatIndexEntry[] }>(statsMod)
    const currency = unwrap<{ currencies: Record<string, string> }>(currencyMod)
    const data: RealmData = {
      id,
      statIndex: buildStatIndex(stats.stats),
      currency: currency.currencies,
    }
    loaded.set(id, data)
    loading.delete(id)
    return data
  })()

  loading.set(id, task)
  return task
}

/** True inside the Tauri webview, where requests bypass the browser's CORS rules. */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * The trade API allows 5 requests / 10s, 15 / 60s, 30 / 300s per IP. A single
 * price check costs two requests, so keep a conservative client-side budget and
 * refuse rather than burn the allowance on a burst.
 *
 * Each realm is a separate host with its own allowance, so the log is per realm
 * — switching realms should not be blocked by the other one's spending.
 */
const WINDOWS: { ms: number; max: number }[] = [
  { ms: 10_000, max: 4 },
  { ms: 60_000, max: 12 },
  { ms: 300_000, max: 25 },
]
const requestLog = new Map<RealmId, number[]>()

function logFor(id: RealmId): number[] {
  let log = requestLog.get(id)
  if (!log) {
    log = []
    requestLog.set(id, log)
  }
  return log
}

export interface RateLimitState {
  usedInWindow: number
  windowSeconds: number
  maxInWindow: number
  /** Milliseconds to wait before the next request is allowed. */
  retryInMs: number
}

export function rateLimitState(id: RealmId = realmId.value, now = Date.now()): RateLimitState {
  const log = logFor(id)
  while (log.length > 0 && now - log[0] > WINDOWS[1].ms) log.shift()
  for (const window of WINDOWS) {
    const inWindow = log.filter((t) => now - t <= window.ms)
    if (inWindow.length >= window.max) {
      return {
        usedInWindow: inWindow.length,
        windowSeconds: window.ms / 1000,
        maxInWindow: window.max,
        retryInMs: inWindow[0] + window.ms - now,
      }
    }
  }
  return { usedInWindow: log.length, windowSeconds: WINDOWS[0].ms / 1000, maxInWindow: WINDOWS[0].max, retryInMs: 0 }
}

export class TradeError extends Error {
  readonly code: string
  constructor(message: string, code = 'trade_error') {
    super(message)
    this.code = code
  }
}

/**
 * The cookie a 国服 search needs. Accepts whatever the player pasted out of
 * DevTools — the bare value or the whole "POESESSID=..." pair — because the
 * useful thing to copy is the pair and the natural thing to copy is the value.
 */
function sessionCookie(raw: string): string {
  const value = raw.trim()
  return value.includes('=') ? value : `POESESSID=${value}`
}

function requestHeaders(target: Realm, extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': UA, ...((extra as Record<string, string>) ?? {}) }
  if (target.id === 'cn') {
    // Only ever sent to the realm it belongs to: this is a live login session
    // for one host, and it must not leak to the other two.
    if (cnSession.value) headers.cookie = sessionCookie(cnSession.value)
    // The Tencent API also wants the request to look like it came from its own
    // trade page; tools that talk to 国服 successfully send both of these.
    //
    // The origin has to be the *host*, not `siteBase` — that one is a path
    // (`https://poe.game.qq.com/trade2`), and a path in an Origin header is not
    // a valid origin. This only started mattering once the plugin stopped
    // dropping these headers (see the `unsafe-headers` note in Cargo.toml);
    // before that the value was never sent, so it was never wrong out loud.
    headers.origin = siteOrigin(target)
    headers.referer = `${target.siteBase}/search`
  }
  return headers
}

/** The one funnel every official-API call goes through, rate limits included. */
export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const target = realmOf(realmId.value)
  if (!isDesktopRuntime()) {
    throw new TradeError('浏览器预览无法直连官方 API(跨域被拦),请使用桌面版。', 'needs_desktop')
  }
  if (target.loginRequired && !cnSession.value) {
    throw new TradeError(
      `${target.label}的交易站要求登录后才能查询。请在「设置」里填入你登录 ${target.apiBase.split('/')[2]} 后的 POESESSID。词缀匹配在本地完成,不受影响。`,
      'needs_session',
    )
  }
  const limit = rateLimitState(target.id)
  if (limit.retryInMs > 0) {
    throw new TradeError(
      `请求过于频繁,请等 ${Math.ceil(limit.retryInMs / 1000)} 秒(${target.label}限流 ${limit.maxInWindow} 次 / ${limit.windowSeconds} 秒)。`,
      'rate_limited',
    )
  }
  logFor(target.id).push(Date.now())
  const res = await tauriFetch(`${target.apiBase}${path}`, {
    ...init,
    headers: requestHeaders(target, init?.headers),
  })
  if (res.status === 401 || res.status === 403) {
    throw new TradeError(
      target.id === 'cn'
        ? '国服交易站拒绝了这次请求(401)。POESESSID 可能已过期,请在设置里重新填入。'
        : `官方接口返回 ${res.status}(被拒绝),请稍后重试。`,
      'unauthorized',
    )
  }
  if (res.status === 429) {
    throw new TradeError('官方接口返回 429(超过速率限制),请稍后重试。', 'rate_limited')
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok) {
    throw new TradeError(body?.error?.message ?? `官方接口错误(HTTP ${res.status})`, `http_${res.status}`)
  }
  return body
}

/**
 * Leagues the player is least likely to want first, in every language the three
 * realms use: the permanent league and its hardcore variant are what a fresh
 * player lands in, but nobody prices items there.
 */
const PERMANENT_RE = /^(standard|hardcore|hc )|永久|標準模式|专家|專家|无情|無情/i

/** Current challenge league first, so the default is what people actually play. */
export async function fetchLeagues(target: Realm = realm.value): Promise<string[]> {
  const body = (await apiFetch('/data/leagues')) as { result?: { id: string; realm?: string }[] }
  const ids = (body.result ?? []).map((l) => l.id)
  const preferred = ids.filter((id) => !PERMANENT_RE.test(id))
  return [...preferred, ...ids.filter((id) => !preferred.includes(id))]
}

export interface PriceCheckResult {
  matches: StatMatch[]
  built: BuiltQuery
  summary: PriceSummary
  /** How many listings the search matched in total (not just the fetched page). */
  total: number
  league: string
  realm: Realm
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
 * Mods are matched against the active realm's templates, which is what makes
 * the realm setting load-bearing rather than cosmetic: the same stat id is
 * described as "# to maximum Life" internationally, "生命上限 #" on 国服 and
 * "#最大生命" on 台服, so the wrong pack matches nothing.
 *
 * When a name search comes back empty, the query is repeated with offline
 * sellers allowed, because that is where a chase unique's listings live.
 */
export async function priceCheck(
  item: GameItem,
  options: { league: string; maxFilters?: number; online?: boolean },
): Promise<PriceCheckResult> {
  const target = realm.value
  const data = await ensureRealmData(target.id)
  const onlineOnly = options.online !== false
  const matches = matchItemMods(item, data.statIndex)

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
  return { matches, ...outcome, league: options.league, realm: target, relaxed }
}

/**
 * League names are per realm ("Runes of Aldur" has no meaning on 国服), so the
 * remembered pick has to be remembered per realm too.
 */
function leagueKey(id: RealmId): string {
  return `poe2coach.tradeLeague.${id}`
}

export function savedLeague(id: RealmId = realmId.value): string | null {
  try {
    return localStorage.getItem(leagueKey(id))
  } catch {
    return null
  }
}

export function rememberLeague(league: string, id: RealmId = realmId.value): void {
  try {
    localStorage.setItem(leagueKey(id), league)
  } catch {
    /* storage disabled — the pick just will not persist */
  }
}

/**
 * The league to query: the remembered one, else the first live one (remembered
 * on success). Every caller that needs "a league, any league" — rate lookups,
 * price checks at page load — wants exactly this fallback chain.
 */
export async function resolveLeague(): Promise<string> {
  const saved = savedLeague()
  if (saved) return saved
  const list = await fetchLeagues()
  const first = list[0] ?? ''
  if (first) rememberLeague(first)
  return first
}
