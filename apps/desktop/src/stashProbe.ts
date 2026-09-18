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
import type { Realm } from '@poe2coach/core'
import { cnSession } from './settings'
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
}

const BODY_PREVIEW = 600
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

function numbersOf(text: string): { items: number | null; tabs: number | null; accountName: string | null } {
  try {
    const parsed = JSON.parse(text) as { items?: unknown; tabs?: unknown; accountName?: unknown }
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.length : null,
      tabs: Array.isArray(parsed?.tabs) ? parsed.tabs.length : null,
      accountName: typeof parsed?.accountName === 'string' ? parsed.accountName : null,
    }
  } catch {
    return { items: null, tabs: null, accountName: null }
  }
}

async function call(
  label: string,
  url: string,
  cookie: string,
  body: { form?: Record<string, string>; json?: unknown } | null,
  realm: Realm,
): Promise<ProbeStep> {
  const headers: Record<string, string> = { 'user-agent': UA }
  if (cookie) headers.cookie = cookie
  if (realm.id === 'cn') {
    // The Tencent API also wants the request to look like it came from its own
    // site, which is what the tools that work against 国服 send.
    headers.origin = realm.siteBase
    headers.referer = `${realm.siteBase}/`
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
    }
  }
}

/**
 * The smallest search the trade site accepts.
 *
 * It has to be a *valid* query: the control's whole job is to tell "the
 * credential is accepted" apart from "the credential never arrived", and a
 * malformed body would come back 400 either way, answering neither.
 */
const CONTROL_QUERY = {
  query: { status: { option: 'online' }, stats: [{ type: 'and', filters: [] }] },
  sort: { price: 'asc' },
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
export async function probeStashAccess(options: ProbeOptions): Promise<ProbeStep[]> {
  if (!isDesktopRuntime()) throw new Error('这个测试需要桌面版:浏览器的跨域策略会拦掉它。')
  const { realm, league, account } = options
  const cookie = realm.id === 'cn' ? (cnSession.value ? sessionCookie(cnSession.value) : '') : ''
  const steps: ProbeStep[] = []

  // Control: does this credential work at all?
  steps.push(
    await call(
      '对照:交易站搜索(已知需要凭证)',
      `${realm.apiBase}/api/trade2/search/poe2/${encodeURIComponent(league)}`,
      cookie,
      { json: CONTROL_QUERY },
      realm,
    ),
  )

  // Who are we logged in as? The stash call wants an account name, and this is
  // the endpoint that hands it over instead of making the player type it.
  const who = await call('取账号名', `${realm.siteBase}/character-window/get-account-name`, cookie, { form: {} }, realm)
  steps.push(who)

  steps.push(
    await call('取角色列表', `${realm.siteBase}/character-window/get-characters`, cookie, { form: {} }, realm),
  )

  const name = account?.trim() || who.accountName || ''
  steps.push(
    await call(
      name ? `读仓库(${name} / ${league})` : '读仓库(未取到账号名)',
      `${realm.siteBase}/character-window/get-stash-items`,
      cookie,
      {
        form: name
          ? { accountName: name, league, tabs: '1', tabIndex: '0' }
          : { league, tabs: '1', tabIndex: '0' },
      },
      realm,
    ),
  )

  return steps
}

/**
 * The answer to the actual question.
 *
 * `refused` means the realm said no with a status; `unknown` means it said yes
 * and then did not send items — usually the HTML login page, which is what a
 * stale cookie looks like. Neither is the same as `empty`, which is a real
 * stash with nothing in the tab that was read.
 */
export function stashVerdict(steps: ProbeStep[]): 'items' | 'empty' | 'refused' | 'unknown' {
  const stash = steps[steps.length - 1]
  if (!stash) return 'unknown'
  if (stash.status !== 200) return stash.status > 0 ? 'refused' : 'unknown'
  if (stash.items == null) return 'unknown'
  return stash.items > 0 ? 'items' : 'empty'
}
