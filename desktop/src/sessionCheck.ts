/**
 * Telling a login apart from a session cookie that merely exists.
 *
 * 国服 hands a `POESESSID` to **every anonymous visitor** the moment the trade
 * page loads — measured: `GET https://poe.game.qq.com/trade2/search` answers
 * `Set-Cookie: POESESSID=…` with no login involved. So "a POESESSID is present"
 * is not evidence of anything, and a login flow built on that check reports
 * success the instant the page renders, before the player has typed a thing.
 * That is exactly what happened: 关联登录 opened a window, the window closed
 * itself a moment later, and what got stored was an anonymous session.
 *
 * The only honest test is to spend one request on something a login unlocks and
 * see whether it comes back 401. That is what this module does, for the login
 * flow and for the stash probe alike, so both agree on what "logged in" means.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { searchUrl, siteOrigin } from '@poe2coach/core'
import type { Realm } from '@poe2coach/core'

const UA = 'poe2-build-coach (desktop; github.com/chenhaolove89/poe2-build-coach)'

/**
 * The smallest search the trade site accepts.
 *
 * It has to be a *valid* query: the point is to tell "authorised" from "not
 * authorised", and a malformed body comes back 400 either way, answering
 * neither.
 */
export const MINIMAL_QUERY = {
  query: { status: { option: 'online' }, stats: [{ type: 'and', filters: [] }] },
  sort: { price: 'asc' },
}

/** What a session check concluded. */
export type SessionVerdict = 'ok' | 'unauthorized' | 'unknown'

export class SessionCheckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionCheckError'
  }
}

/**
 * Leagues for a realm, from the public endpoint.
 *
 * Deliberately not the app's own `fetchLeagues`: that one refuses to run without
 * a session, and this is needed *before* there is one — the whole point is to
 * find out whether the session works.
 */
export async function publicLeagues(realm: Realm): Promise<string[]> {
  const res = await tauriFetch(`${realm.apiBase}/data/leagues`, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new SessionCheckError(`取联赛列表失败(HTTP ${res.status})`)
  const body = (await res.json()) as { result?: { id?: string }[] }
  const ids = (body.result ?? []).map((l) => l.id).filter((id): id is string => !!id)
  // The permanent league is never where anyone plays; the first entry is the
  // current challenge league, which is what a search should be aimed at.
  const preferred = ids.filter((id) => !/^(standard|hardcore|hc )|永久|標準模式|专家|專家/i.test(id))
  return [...preferred, ...ids.filter((id) => !preferred.includes(id))]
}

/**
 * Ask the realm whether this cookie is a login.
 *
 * A 401/403 means the cookie is not authorised (or is anonymous, which is the
 * same thing to the server). A 429 means the rate limit was hit and says nothing
 * about the cookie, so it is reported as `unknown` rather than as a refusal —
 * treating it as a refusal would make a working login look broken whenever a
 * price check had just run.
 */
export async function sessionAuthorized(realm: Realm, cookie: string, league: string): Promise<SessionVerdict> {
  if (!cookie || !league) return 'unknown'
  const headers: Record<string, string> = {
    'user-agent': UA,
    'content-type': 'application/json',
    cookie,
  }
  if (realm.id === 'cn') {
    // The Tencent API wants the request to look like it came from its own trade
    // page. The origin must be the host: `siteBase` is a path, and a path in an
    // Origin header is not a valid origin.
    headers.origin = siteOrigin(realm)
    headers.referer = `${realm.siteBase}/search`
  }
  try {
    const res = await tauriFetch(searchUrl(realm, league), {
      method: 'POST',
      headers,
      body: JSON.stringify(MINIMAL_QUERY),
    })
    if (res.status === 401 || res.status === 403) return 'unauthorized'
    if (res.status === 429) return 'unknown'
    return res.ok ? 'ok' : 'unknown'
  } catch {
    return 'unknown'
  }
}
