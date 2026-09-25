/**
 * The share payload rules, server-side.
 *
 * The server is deliberately independent of @poe2coach/core — it holds opaque
 * text and serves it back; the far side re-validates everything on import. The
 * only logic worth duplicating is the hygiene gate: a P2C1 code must carry our
 * prefix and inflate to a version-1 payload, which keeps arbitrary bytes out of
 * the store without importing the app's decoding rules.
 */
import { inflateSync } from 'node:zlib'

export const SHARE_PREFIX = 'P2C1.'
export const MAX_CODE_CHARS = 32 * 1024
export const TTL_MS = 365 * 24 * 60 * 60 * 1000
export const ID_LEN = 8
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Whether `code` is a payload we are willing to store. Hygiene, not trust. */
export function validCode(code: unknown): code is string {
  if (typeof code !== 'string' || !code.startsWith(SHARE_PREFIX)) return false
  if (code.length > MAX_CODE_CHARS) return false
  try {
    const body = code.slice(SHARE_PREFIX.length).replace(/\s+/g, '')
    const raw: unknown = JSON.parse(inflateSync(Buffer.from(body, 'base64url')).toString('utf-8'))
    return !!raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1
  } catch {
    return false
  }
}

/** The display fields a summary may carry, whitelisted and length-capped. */
export function cleanSummary(raw: unknown): Record<string, string | number | null> | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    realm: str(record.realm),
    league: str(record.league),
    level: num(record.level),
    className: str(record.className),
    ascendClassName: str(record.ascendClassName),
    questPoints: num(record.questPoints),
    passives: num(record.passives) ?? 0,
    atlas: num(record.atlas) ?? 0,
    items: num(record.items) ?? 0,
    skills: num(record.skills) ?? 0,
  }
}

/** A short public id. 8 base62 chars is ~2^48 of space; collisions are retried by the caller. */
export function newId(): string {
  const bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(ID_LEN)))
  let id = ''
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length]
  return id
}

export const ID_PATTERN = /^[A-Za-z0-9]{4,32}$/
