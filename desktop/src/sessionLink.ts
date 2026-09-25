/**
 * Linking a realm's login session.
 *
 * The trade site keeps a session in an HttpOnly `POESESSID` cookie, which the
 * page's own JavaScript cannot read. Rather than ask the player to dig it out
 * of DevTools, the app opens the realm's real trade page in a second webview —
 * the same page and the same login the player would use in a browser — and
 * reads the cookie out of that webview's store from Rust.
 *
 * The password is typed into the operator's own page and never reaches this
 * app; all that comes back is the session cookie, which is what the browser
 * would have sent anyway.
 *
 * **Finding a cookie is not logging in.** 国服 issues a `POESESSID` to every
 * anonymous visitor as soon as the trade page loads, so the first version of
 * this flow declared success the instant the window rendered, closed itself, and
 * stored an anonymous session. The cookie is therefore *verified* against a real
 * search before it is accepted, and the window stays open until that passes.
 */
import { invoke } from '@tauri-apps/api/core'
import type { Realm } from '@poe2coach/core'
import { publicLeagues, sessionAuthorized } from './sessionCheck'
import { savedLeague } from './tradeClient'

/** How often to ask the login window whether the session cookie exists yet. */
const POLL_MS = 1500

/**
 * How often to spend a request checking whether the cookie is authorised.
 *
 * The trade API allows 5 requests / 10s, 15 / 60s and 30 / 300s per IP, so one
 * check every five seconds sits inside every window with room left for the price
 * checks the player is doing in another tab. Checking on every poll would be
 * 6.7 / 10s and would get the app throttled for its own login.
 */
const VERIFY_MS = 5000

/** A forgotten window should not keep polling forever. */
const TIMEOUT_MS = 10 * 60 * 1000

/** What the login window is currently waiting on, for the UI to narrate. */
export type LinkProgress = 'waiting' | 'verifying' | 'unverified'

export class SessionLinkError extends Error {
  readonly code: 'timeout' | 'closed' | 'unsupported' | 'league'
  constructor(message: string, code: 'timeout' | 'closed' | 'unsupported' | 'league') {
    super(message)
    this.name = 'SessionLinkError'
    this.code = code
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Open the realm's sign-in page and wait until the login actually works.
 *
 * Resolves with the cookie in `name=value` form, and always closes the login
 * window on the way out. Rejects with {@link SessionLinkError} when the player
 * closes the window instead of logging in, or after {@link TIMEOUT_MS}.
 */
export async function linkRealmSession(
  realm: Realm,
  onProgress?: (state: LinkProgress) => void,
): Promise<string> {
  const origin = new URL(realm.apiBase).origin
  // Opening the window also clears any session cookie left over from a previous
  // attempt. It does not help against the anonymous cookie — that one is issued
  // fresh on load — which is why the check below exists.
  await invoke('open_login_window', { url: realm.siteBase, origin })

  // A league is needed to aim the verification search at. The public list works
  // without a session, which matters because this runs before there is one.
  let league = savedLeague(realm.id) ?? ''
  if (!league) {
    try {
      league = (await publicLeagues(realm))[0] ?? ''
    } catch {
      /* the search below will report 'unknown' and the loop keeps waiting */
    }
  }
  if (!league) {
    await cancelRealmLogin()
    throw new SessionLinkError('取不到联赛列表,无法验证登录。请检查网络后重试。', 'league')
  }

  const deadline = Date.now() + TIMEOUT_MS
  let lastVerified = 0
  try {
    for (;;) {
      if (Date.now() > deadline) {
        throw new SessionLinkError('登录超时,请重试。', 'timeout')
      }
      await sleep(POLL_MS)
      let cookie: string | null
      try {
        cookie = await invoke<string | null>('read_session_cookie', { origin })
      } catch {
        // The window is gone, so the player closed it without logging in.
        throw new SessionLinkError('登录窗口已关闭。', 'closed')
      }
      if (!cookie) {
        onProgress?.('waiting')
        continue
      }

      /*
       * Re-verify on a timer rather than when the value changes. Logging in
       * usually *upgrades* the existing session, leaving the cookie string
       * identical — so "the value is the same as last time" would mean the loop
       * never checks again after the first anonymous failure, and the login would
       * hang until it timed out.
       */
      if (Date.now() - lastVerified < VERIFY_MS) {
        onProgress?.('unverified')
        continue
      }
      lastVerified = Date.now()
      onProgress?.('verifying')
      const verdict = await sessionAuthorized(realm, cookie, league)
      if (verdict === 'ok') return cookie
      onProgress?.(verdict === 'unauthorized' ? 'unverified' : 'verifying')
    }
  } finally {
    await cancelRealmLogin()
  }
}

export async function cancelRealmLogin(): Promise<void> {
  try {
    await invoke('close_login_window')
  } catch {
    /* already closed, or never opened */
  }
}
