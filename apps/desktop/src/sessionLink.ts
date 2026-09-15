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
 */
import { invoke } from '@tauri-apps/api/core'
import type { Realm } from '@poe2coach/core'

/** How often to ask the login window whether the session cookie exists yet. */
const POLL_MS = 1500

/** A forgotten window should not keep polling forever. */
const TIMEOUT_MS = 10 * 60 * 1000

export class SessionLinkError extends Error {
  readonly code: 'timeout' | 'closed' | 'unsupported'
  constructor(message: string, code: 'timeout' | 'closed' | 'unsupported') {
    super(message)
    this.name = 'SessionLinkError'
    this.code = code
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Open the realm's sign-in page and wait for the player to finish.
 *
 * Resolves with the cookie in `name=value` form, and always closes the login
 * window on the way out. Rejects with {@link SessionLinkError} when the player
 * closes the window instead of logging in, or after {@link TIMEOUT_MS}.
 */
export async function linkRealmSession(realm: Realm): Promise<string> {
  const origin = new URL(realm.apiBase).origin
  // Opening the window also clears any session cookie left over from a
  // previous attempt, so an expired one cannot be read back as a fresh success.
  await invoke('open_login_window', { url: realm.siteBase, origin })

  const deadline = Date.now() + TIMEOUT_MS
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
      if (cookie) return cookie
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
