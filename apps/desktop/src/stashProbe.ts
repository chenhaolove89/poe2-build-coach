/**
 * A one-off probe of the `character-window` endpoints, to answer a question no
 * amount of reading settles: **does PoE2 hand out stash contents at all?**
 *
 * The official API reference marks the stash endpoints as PoE1 only, and a
 * community tool reported GGG closing PoE2 inventory reads — but the routes
 * plainly still exist on all three sites (a nonsense path 404s while these
 * 401/403), so the only way to know is to ask with a real session.
 *
 * The answer decides whether "today's income" can ever be computed the way the
 * price checkers do it — snapshot the stash, price it, subtract — or whether
 * that whole approach is dead on PoE2.
 *
 * The credential is never sent anywhere but the realm it belongs to, never
 * echoed into the result, and never logged.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { characterWindowUrl, searchUrl, siteOrigin } from '@poe2coach/core'
import type { Realm } from '@poe2coach/core'
import { cnSession } from './settings'
import { MINIMAL_QUERY } from './sessionCheck'
import { isDesktopRuntime } from './tradeClient'

export interface ProbeStep {
  label: string
  url: string
  status: number
  /** The answer in one line: what came back, in words. */
  summary: string
  /** The head of the body, because a login wall is HTML, not an error code. */
  body: string
  /**
   * Fields read out of the **whole** body before it was trimmed for display.
   * Reading them back out of {@link body} would be wrong — a stash page is far
   * longer than the preview, so `JSON.parse` on the preview always fails and a
   * success would be reported as an unknown.
   */
  items: number | null
  tabs: number | null
  accountName: string | null
  /** Leagues seen in a character list — a league the account demonstrably has. */
  leagues: string[] | null
  /** Character names seen in a character list. */
  characters: string[] | null
}

const BODY_PREVIEW = 600

/**
 * Minimum gap between probe requests.
 *
 * The trade API allows 5 requests / 10s per IP, and the probe fires a handful in
 * a row. Without pacing the later ones come back 429, which looks like a refusal
 * and would be read as an answer. 2.5s keeps at most four inside any ten-second
 * window.
 */
const REQUEST_GAP_MS = 2500
let lastRequestAt = 0

async function pace(): Promise<void> {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}
const UA = 'poe2-build-coach (desktop; github.com/chenhaolove89/poe2-build-coach)'

function head(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > BODY_PREVIEW ? `${flat.slice(0, BODY_PREVIEW)}…` : flat
}

/** The cookie in the "name=value" form, from whatever the player pasted. */
function sessionCookie(raw: string): string {
  const value = raw.trim()
  return value.includes('=') ? value : `POESESSID=${value}`
}

/**
 * What a body looks like, in words.
 *
 * The interesting failure is not an error code — it is a 200 carrying the site's
 * HTML login page, which happens when a session cookie is present but stale.
 * Saying "HTML 登录页" out loud is the difference between a five-second read and
 * an hour of guessing.
 */
function describe(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) return 'HTML 页面(不是 JSON)'
  if (!trimmed) return '空响应'
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return `JSON 数组,${parsed.length} 项`
    if (parsed && typeof parsed === 'object') return `JSON 对象,字段:${Object.keys(parsed).slice(0, 8).join(', ')}`
    return `JSON ${typeof parsed}`
  } catch {
    return '不是 JSON'
  }
}

function numbersOf(text: string): {
  items: number | null
  tabs: number | null
  accountName: string | null
  leagues: string[] | null
  /** Character names, which some builds of the stash call accept in place of an account. */
  characters: string[] | null
} {
  try {
    const parsed = JSON.parse(text) as { items?: unknown; tabs?: unknown; accountName?: unknown }
    const list = Array.isArray(parsed) ? (parsed as { league?: unknown; name?: unknown }[]) : null
    const strings = (pick: (c: { league?: unknown; name?: unknown }) => unknown) =>
      list
        ? [...new Set(list.map(pick).filter((v): v is string => typeof v === 'string' && v.length > 0))]
        : null
    const leagues = strings((c) => c?.league)
    const characters = strings((c) => c?.name)
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.length : null,
      tabs: Array.isArray(parsed?.tabs) ? parsed.tabs.length : null,
      accountName: typeof parsed?.accountName === 'string' ? parsed.accountName : null,
      leagues,
      characters,
    }
  } catch {
    return { items: null, tabs: null, accountName: null, leagues: null, characters: null }
  }
}

async function call(
  label: string,
  url: string,
  cookie: string,
  body: { form?: Record<string, string>; json?: unknown } | null,
  realm: Realm,
  /** The page a browser would have sent this request from. */
  page: string,
): Promise<ProbeStep> {
  const headers: Record<string, string> = { 'user-agent': UA }
  if (cookie) headers.cookie = cookie
  // `siteBase` is a path, not an origin, so it must not go into these headers.
  const origin = siteOrigin(realm)
  headers.origin = origin
  headers.referer = page
  if (realm.id === 'cn') {
    // The Tencent API also wants the request to look like it came from its own
    // site, which is what the tools that work against 国服 send.
    headers['accept-language'] = 'zh-CN,zh;q=0.9'
  }
  let payload: string | undefined
  if (body?.json !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body.json)
  } else if (body?.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(body.form).toString()
  }
  try {
    await pace()
    const res = await tauriFetch(url, { method: 'POST', headers, body: payload })
    const text = await res.text()
    return { label, url, status: res.status, summary: describe(text), body: head(text), ...numbersOf(text) }
  } catch (e) {
    return {
      label,
      url,
      status: 0,
      summary: `请求失败:${e instanceof Error ? e.message : String(e)}`,
      body: '',
      items: null,
      tabs: null,
      accountName: null,
      leagues: null,
      characters: null,
    }
  }
}

/** Shared with the login flow, so both agree on what a valid search is. */
const CONTROL_QUERY = MINIMAL_QUERY

export interface ProbeReport {
  steps: ProbeStep[]
  /**
   * Whether a credential went out at all, and how long it is — never its value.
   *
   * Without this, "still 401" cannot be told apart from "nothing was sent", and
   * those have different fixes (re-link vs. look for a bug). It is the question
   * the first run of this probe could not answer.
   */
  credential: { attached: boolean; length: number }
}

export interface ProbeOptions {
  realm: Realm
  league: string
  /** Optional: the account name to read the stash of, if it is known. */
  account?: string
}

/**
 * Run the sequence and return every step, in order.
 *
 * The first step is a **control**: a trade search, which is the one request we
 * already know works with a 国服 session. Without it a 401 from the stash call
 * would be ambiguous — it could mean the endpoint refuses PoE2, or merely that
 * the cookie never reached the server, and those two lead to opposite
 * conclusions.
 */
export async function probeStashAccess(options: ProbeOptions): Promise<ProbeReport> {
  if (!isDesktopRuntime()) throw new Error('这个测试需要桌面版:浏览器的跨域策略会拦掉它。')
  const { realm, league, account } = options
  const cookie = realm.id === 'cn' ? (cnSession.value ? sessionCookie(cnSession.value) : '') : ''
  const steps: ProbeStep[] = []

  // Control: does this credential work at all?
  steps.push(
    await call(
      '对照:交易站搜索(已知需要凭证)',
      searchUrl(realm, league),
      cookie,
      { json: CONTROL_QUERY },
      realm,
      `${realm.siteBase}/search`,
    ),
  )

  // Who are we logged in as? The stash call wants an account name, and this is
  // the endpoint that hands it over instead of making the player type it.
  const who = await call(
    '取账号名',
    characterWindowUrl(realm, 'get-account-name'),
    cookie,
    { form: {} },
    realm,
    `${realm.siteBase}/`,
  )
  if (who.status === 404) {
    // With a *valid* session this 404s on 国服 too, so the endpoint simply does
    // not exist. An earlier note here claimed 国服 had it, based on a 401 — but
    // 国服's login wall answers 401 for paths that do not exist as readily as for
    // ones that do, so that reading was worthless. Saying "does not exist" stops
    // a bare 404 from looking like a failure to fix.
    who.summary = `${who.summary} —— 这个接口不存在(带着有效会话也是 404),账号名得另找`
  }
  steps.push(who)

  const chars = await call(
    '取角色列表',
    characterWindowUrl(realm, 'get-characters'),
    cookie,
    { form: {} },
    realm,
    `${realm.siteBase}/`,
  )
  steps.push(chars)

  const name = account?.trim() || who.accountName || ''
  for (const variant of stashVariants(league, chars.leagues, name, chars.characters)) {
    steps.push(
      await call(
        `读仓库 · ${variant.label}`,
        characterWindowUrl(realm, 'get-stash-items'),
        cookie,
        { form: variant.form },
        realm,
        `${realm.siteBase}/`,
      ),
    )
  }

  return { steps, credential: { attached: cookie.length > 0, length: cookie.length } }
}

/**
 * Parameter shapes for the stash read, tried in order.
 *
 * The endpoint answers 400 "Invalid query" with a valid session and no account
 * name, which means the route is open and the *request* is wrong — a different
 * problem from a 401/403, and one that only a few more attempts can settle.
 * Each variant costs one request and they are paced, so the whole matrix is a
 * couple of extra seconds rather than a new round trip.
 *
 * The alternate league comes from the character list: an account that has a
 * character in a league definitely has a stash there, so it removes "the league
 * name is wrong" from the list of suspects.
 */
function stashVariants(
  league: string,
  characterLeagues: string[] | null,
  accountName: string,
  characterNames: string[] | null,
): { label: string; form: Record<string, string> }[] {
  const base: Record<string, string> = { league, tabs: '1', tabIndex: '0' }
  if (accountName) base.accountName = accountName
  const tag = accountName ? `${accountName} / ` : ''

  const variants: { label: string; form: Record<string, string> }[] = [
    { label: `${tag}${league}`, form: { ...base } },
    { label: `+realm=poe2`, form: { ...base, realm: 'poe2' } },
    { label: `+realm=pc`, form: { ...base, realm: 'pc' } },
    { label: 'tabs=0', form: { ...base, tabs: '0' } },
  ]
  for (const other of characterLeagues ?? []) {
    if (other === league) continue
    variants.push({ label: `league=${other}`, form: { ...base, league: other } })
  }
  // No endpoint hands over the account name, so the only other identity to hand
  // the call is a character's. Cheap to try, and it rules the parameter out.
  const character = characterNames?.[0]
  if (!accountName && character) {
    variants.push({ label: `accountName=${character}`, form: { ...base, accountName: character } })
  }
  return variants
}

/**
 * The answer to the actual question.
 *
 * `served` is the one that matters, and it does **not** require items: a
 * response carrying an `items` array — even an empty one — means the realm
 * answered a PoE2 stash read, which is the whole question. An empty array is a
 * readable stash with nothing in that tab, not a failure, and calling it one
 * would send the search looking for a problem that is not there.
 *
 * `refused` is a status saying no. `unknown` is a 200 that carried no stash
 * structure at all — usually the site's HTML login page, which is what a stale
 * cookie looks like.
 */
export function stashVerdict(steps: ProbeStep[]): 'served' | 'badparams' | 'refused' | 'unknown' {
  const stash = steps.filter((s) => s.label.startsWith('读仓库'))
  if (stash.length === 0) return 'unknown'
  if (stash.some((s) => s.status === 200 && (s.items != null || s.tabs != null))) return 'served'
  // 400 is the endpoint arguing about the request, not refusing the caller —
  // and it is only reachable at all once the session is accepted.
  if (stash.some((s) => s.status === 400)) return 'badparams'
  if (stash.some((s) => s.status === 401 || s.status === 403)) return 'refused'
  return 'unknown'
}
