/**
 * A one-off probe of the `character-window` endpoints, answering one question
 * no amount of reading settles: **does PoE2 hand out stash contents at all?**
 *
 * Everything below is pinned by a live experiment against 国服 (2026-09-19, a
 * real logged-in session), which is why the steps are shaped the way they are:
 *
 * - The endpoint the official site itself calls is
 *   `GET /character-window/get-stash-items` with `{accountName, realm, league,
 *   tabs, tabIndex}` — read straight out of Tencent's own minified bundle.
 *   There is no `characterName` param and the method is GET, not POST.
 * - The `accountName` it wants is the **login identity** as the site chrome
 *   renders it (`暖冬丶丶#1238` — QQ nickname, `#`, discriminator), not a
 *   character name and not the dash form the profile URLs use. The chrome of
 *   every server-rendered page carries it as the profile link's anchor text,
 *   which is where the probe scrapes it from.
 * - The error ladder is strict, which is what makes a diagnosis possible:
 *   **403** (HTML 权限被拒绝) fires *before anything else* whenever the
 *   accountName is not exactly the session's identity — a fake name, a
 *   character name and the dash form all 403; **400** "Invalid query" means
 *   the identity passed and the *league* is unknown; **404** means identity
 *   and league both valid but **no stash resource exists there**.
 *
 * That ladder is why the probe spends one request on a deliberately invalid
 * league: a 400 there proves the identity was right, so the 404s from the real
 * reads can only mean "this system has no stash data" — and since 国服's
 * character-window returns PoE1 characters only (last logins from 2018, a
 * "PoE 1 PC" profile) and its own frontend has no PoE2 stash feature at all, a
 * 404 is the system saying PoE2 stash does not exist in it.
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
 * Two HTML pages mean specific things here, so they get named: the 权限被拒绝
 * page is the identity mismatch (it fires before any other check), and any
 * other HTML with a valid-looking session is usually a stale cookie's login
 * wall. Saying which out loud is the difference between a five-second read and
 * an hour of guessing.
 */
function describe(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) {
    if (trimmed.includes('权限被拒绝'))
      return 'HTML:权限被拒绝 —— 请求里的账号名不是当前登录的身份(仓库只能看自己的)'
    return 'HTML 页面(不是 JSON)'
  }
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

const EMPTY_STEP = {
  items: null,
  tabs: null,
  accountName: null,
  leagues: null,
  characters: null,
} as const

async function call(
  label: string,
  url: string,
  cookie: string,
  init: { method?: 'GET' | 'POST'; form?: Record<string, string>; json?: unknown; query?: Record<string, string> },
  realm: Realm,
  /** The page a browser would have sent this request from. */
  page: string,
): Promise<ProbeStep> {
  const headers: Record<string, string> = { 'user-agent': UA }
  if (cookie) headers.cookie = cookie
  // `siteBase` is a path, not an origin, so it must not go into these headers.
  const origin = siteOrigin(realm)
  if (init.method !== 'GET') headers.origin = origin
  headers.referer = page
  if (realm.id === 'cn') {
    // The Tencent API also wants the request to look like it came from its own
    // site, which is what the tools that work against 国服 send.
    headers['accept-language'] = 'zh-CN,zh;q=0.9'
  }
  let payload: string | undefined
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(init.json)
  } else if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(init.form).toString()
  }
  const href = init.query ? `${url}?${new URLSearchParams(init.query).toString()}` : url
  try {
    await pace()
    const res = await tauriFetch(href, { method: init.method ?? 'POST', headers, body: payload })
    const text = await res.text()
    return { label, url: href, status: res.status, summary: describe(text), body: head(text), ...numbersOf(text) }
  } catch (e) {
    return { label, url: href, status: 0, summary: `请求失败:${e instanceof Error ? e.message : String(e)}`, body: '', ...EMPTY_STEP }
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
   * those have different fixes (re-link vs. look for a bug).
   */
  credential: { attached: boolean; length: number }
}

export interface ProbeOptions {
  realm: Realm
  league: string
  /** Fallback only: the account name, used when the chrome scrape finds nothing. */
  account?: string
}

/**
 * The login identity as the site chrome renders it, scraped from any
 * server-rendered page.
 *
 * Every 国服 page's header carries 「现在登录账号 <a href="/account/view-profile/…">
 * 暖冬丶丶#1238</a>」 — and that anchor text is exactly the accountName form the
 * stash endpoint accepts (the dash form in the href does not work; a character
 * name does not either). Scraping beats asking the player to type it: they
 * cannot see the `#discriminator` half anywhere in the game.
 */
const IDENTITY_RE = /现在登录账号[\s\S]{0,300}?<a href="\/account\/view-profile\/[^"]*">([^<]+)</

async function scrapeIdentity(realm: Realm, cookie: string): Promise<ProbeStep> {
  const label = '抓登录身份'
  const url = `${realm.siteBase}/search`
  if (realm.id !== 'cn') {
    return {
      label,
      url,
      status: 0,
      summary: '只在国服做这一步:国服的页面头部写着当前登录账号,其它服没有这个形状的头部。',
      body: '',
      ...EMPTY_STEP,
    }
  }
  try {
    await pace()
    const res = await tauriFetch(url, {
      method: 'GET',
      headers: { 'user-agent': UA, cookie, referer: url, 'accept-language': 'zh-CN,zh;q=0.9' },
    })
    const text = await res.text()
    const found = IDENTITY_RE.exec(text)?.[1]?.trim() ?? null
    return {
      label,
      url,
      status: res.status,
      summary: found
        ? `从页面头部抓到登录身份:${found} —— 仓库接口要的账号名就是这个形状`
        : '页面打开了,但头部没有登录身份 —— 这个会话多半没有真正登录,请重新「关联登录」。',
      body: '',
      items: null,
      tabs: null,
      accountName: found,
      leagues: null,
      characters: null,
    }
  } catch (e) {
    return {
      label,
      url,
      status: 0,
      summary: `请求失败:${e instanceof Error ? e.message : String(e)}`,
      body: '',
      ...EMPTY_STEP,
    }
  }
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
  const page = `${realm.siteBase}/`

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

  // Who is logged in? The list also names the leagues the account actually has
  // characters in, which is where a stash can exist at all.
  const chars = await call('取角色列表', characterWindowUrl(realm, 'get-characters'), cookie, { form: {} }, realm, page)
  steps.push(chars)

  const identity = await scrapeIdentity(realm, cookie)
  steps.push(identity)
  const name = identity.accountName ?? account?.trim() ?? ''

  if (!name) {
    steps.push({
      label: '读仓库(跳过)',
      url: characterWindowUrl(realm, 'get-stash-items'),
      status: 0,
      summary: '没有账号名可发:页面头部没抓到登录身份,手填的也是空的。这个接口不认角色名,只认登录身份。',
      body: '',
      ...EMPTY_STEP,
    })
    return { steps, credential: { attached: cookie.length > 0, length: cookie.length } }
  }

  // One deliberately-broken request buys certainty for every later 404: if an
  // invalid league comes back 400, the identity was accepted — a valid-league
  // 404 then means "no stash data here", not "who is this?".
  steps.push(
    await call(
      '身份自检·故意无效的联赛',
      characterWindowUrl(realm, 'get-stash-items'),
      cookie,
      { method: 'GET', query: { accountName: name, realm: 'poe2', league: '自检·联赛名故意无效', tabs: '1', tabIndex: '0' } },
      realm,
      page,
    ),
  )

  const charLeague = chars.leagues?.[0] ?? null
  steps.push(
    await call(
      `读仓库·PoE2 · ${league}`,
      characterWindowUrl(realm, 'get-stash-items'),
      cookie,
      { method: 'GET', query: { accountName: name, realm: 'poe2', league, tabs: '1', tabIndex: '0' } },
      realm,
      page,
    ),
  )
  if (charLeague && charLeague !== league) {
    steps.push(
      await call(
        `读仓库·PoE2 · league=${charLeague}`,
        characterWindowUrl(realm, 'get-stash-items'),
        cookie,
        { method: 'GET', query: { accountName: name, realm: 'poe2', league: charLeague, tabs: '1', tabIndex: '0' } },
        realm,
        page,
      ),
    )
  }
  // The system itself is PoE1 ("PoE 1 PC" profiles, PoE1 characters in the
  // list), so one PoE1 read tells "PoE2 only is missing" from "the whole stash
  // area serves nothing".
  steps.push(
    await call(
      `读仓库·PoE1 对照 · league=${charLeague ?? league}`,
      characterWindowUrl(realm, 'get-stash-items'),
      cookie,
      { method: 'GET', query: { accountName: name, realm: 'pc', league: charLeague ?? league, tabs: '1', tabIndex: '0' } },
      realm,
      page,
    ),
  )

  return { steps, credential: { attached: cookie.length > 0, length: cookie.length } }
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
 * The ladder behind `no-data` matters: the 身份自检 step proves the identity was
 * accepted (an invalid league gets 400 only past the identity check), so its
 * 404s are the system saying the stash resource does not exist — which, for a
 * PoE1-only system, is the PoE2 answer. `identity-rejected` is the 403 wall
 * that fires before any check when the accountName is not the session's own.
 */
export function stashVerdict(steps: ProbeStep[]): 'served' | 'no-data' | 'identity-rejected' | 'refused' | 'unknown' {
  const selfCheck = steps.find((s) => s.label.startsWith('身份自检'))
  const stash = steps.filter((s) => s.label.startsWith('读仓库') && !s.label.includes('跳过'))
  if (stash.length === 0) return 'unknown'
  if (stash.some((s) => s.status === 200 && (s.items != null || s.tabs != null))) return 'served'
  if (steps.some((s) => s.status === 401)) return 'refused'
  if (steps.some((s) => s.status === 403)) return 'identity-rejected'
  if (selfCheck?.status === 400 && stash.some((s) => s.status === 404)) return 'no-data'
  return 'unknown'
}
