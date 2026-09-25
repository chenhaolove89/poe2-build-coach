/**
 * 链接分享 —— the share code, also reachable as a short URL.
 *
 * The P2C1 code is complete on its own and works offline forever; the link is a
 * courtesy for chat apps, where a click beats a copy-paste of 700 characters. The
 * shape is deliberately boring: upload the code to the share server, get a short
 * id back, hand out a URL on the same server that fetches and displays it. The
 * payload that gets uploaded is exactly the code the sharer was already about to
 * hand over — a P2C1 payload cannot carry credentials by construction — so the
 * server needs no auth and holds no secrets.
 *
 * The server is a Next.js app (`server`) that serves both the API and the
 * /s/:id landing pages, so one base URL wires everything. That constant is
 * deployment wiring (docs/share-server.md). The localStorage key is a dev
 * override so the whole flow runs against a local `next dev` without touching
 * the shipped constant — invisible, no settings UI, per the 设置页精简 rule.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { ShareSnapshot } from '@poe2coach/core'
import { isDesktopRuntime } from './tradeClient'

/** The share server (API + /s/ pages). Filled in at deployment; see docs/share-server.md. */
/** The share server (API + /s/ pages). Live on cinaka.com behind nginx; the /poe2 path is the app's basePath. */
export const SHARE_SERVER_PROD = 'https://cinaka.com/poe2'

const DEV_API_KEY = 'poe2coach.shareApiBase'

function serverBase(): string {
  try {
    return localStorage.getItem(DEV_API_KEY) || SHARE_SERVER_PROD
  } catch {
    return SHARE_SERVER_PROD
  }
}

export class ShareLinkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'ShareLinkError'
  }
}

/** The display summary uploaded alongside the code, for the link page's chips. */
export interface ShareSummary {
  realm: string | null
  league: string | null
  level: number | null
  className: string | null
  ascendClassName: string | null
  questPoints: number | null
  passives: number
  atlas: number
  items: number
  skills: number
}

export function summaryOf(snapshot: ShareSnapshot): ShareSummary {
  return {
    realm: snapshot.realm,
    league: snapshot.league,
    level: snapshot.level,
    className: snapshot.className,
    ascendClassName: snapshot.ascendClassName,
    questPoints: snapshot.questPoints,
    passives: snapshot.passiveNodes.length,
    atlas: snapshot.atlasNodes.length,
    items: snapshot.items.length,
    skills: snapshot.skills.length,
  }
}

/**
 * Whether a paste is a share link rather than a code.
 *
 * Scoped to our own `/s/` links so an arbitrary pasted URL is not fetched — the
 * box is for codes, and this branch only fires for the shape we hand out.
 */
export function isShareUrl(text: string): boolean {
  return /^https?:\/\/\S+\/s\/(?:index\.html\?)?/i.test(text.trim())
}

/** The id inside one of our links — `/s/<id>` or the older `?i=<id>` — or null. */
export function shareIdFromUrl(text: string): string | null {
  try {
    const url = new URL(text.trim())
    const pathMatch = url.pathname.match(/\/s\/([A-Za-z0-9]{4,32})\/?$/)
    if (pathMatch) return pathMatch[1]
    if (!url.pathname.match(/\/s\/(?:index\.html)?$/)) return null
    const id = url.searchParams.get('i')
    return id && /^[A-Za-z0-9]{4,32}$/.test(id) ? id : null
  } catch {
    return null
  }
}

/** The link a recipient opens, given an id from the server. */
export function shareLinkFor(id: string): string {
  return `${serverBase().replace(/\/+$/, '')}/s/${encodeURIComponent(id)}`
}

/** Desktop talks to the API through the Tauri HTTP plugin; browser preview uses plain fetch. */
async function httpJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const doFetch = isDesktopRuntime() ? tauriFetch : fetch
  let res: Response
  try {
    res = await doFetch(url, init)
  } catch (cause) {
    throw new ShareLinkError('连不上分享服务 —— 检查网络后重试。', cause)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || body.ok !== true) {
    const reason = typeof body.error === 'string' ? body.error : `服务返回 ${res.status}`
    throw new ShareLinkError(reason)
  }
  return body
}

/**
 * Upload a code, return the shareable link.
 *
 * Only the code and its display summary leave the app; both are derived from the
 * same live state the on-screen code already shows.
 */
export async function uploadShareCode(
  code: string,
  summary: ShareSummary,
): Promise<{ id: string; link: string; expiresAt: number }> {
  const base = serverBase()
  if (!base) {
    throw new ShareLinkError('分享服务还没配置 —— 部署后此按钮可用,见 docs/share-server.md。串分享不受影响。')
  }
  const body = await httpJson(`${base.replace(/\/+$/, '')}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, summary }),
  })
  const id = typeof body.id === 'string' ? body.id : null
  const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : null
  if (!id) throw new ShareLinkError('服务返回的数据不完整。')
  return { id, link: shareLinkFor(id), expiresAt: expiresAt ?? 0 }
}

/**
 * Fetch the code a link points at. The far side still runs the full decoder, so
 * whatever comes back is validated like a pasted code — the link only changes
 * where the text came from.
 */
export async function resolveShareLink(text: string): Promise<string> {
  const base = serverBase()
  const id = shareIdFromUrl(text)
  if (!id) throw new ShareLinkError('这不是本工具的分享链接。')
  if (!base) {
    throw new ShareLinkError('分享服务还没配置 —— 部署后此功能可用,见 docs/share-server.md。直接粘分享码不受影响。')
  }
  const body = await httpJson(`${base.replace(/\/+$/, '')}/api/share/${encodeURIComponent(id)}`)
  return typeof body.code === 'string' ? body.code : ''
}
