/**
 * One code that carries everything the app has been set up with.
 *
 * Four things are worth handing to someone else: which realm and league you are on,
 * the passive tree you are following, the Atlas tree you have planned, and the gear
 * you pasted in. A PoB code carries only the first and third of those, and nothing
 * in the app carried the Atlas plan at all, so this is its own format rather than a
 * PoB extension.
 *
 * Two rules the format exists to enforce:
 *
 *   - **No credentials, ever.** The 国服 session cookie is a login, not a setting;
 *     a share code that carried it would hand over the account. `ShareSnapshot` has
 *     no field for it and the encoder writes only the fields it declares, so a code
 *     cannot leak one by accident.
 *   - **The code is untrusted input.** It arrives as text someone else produced, so
 *     decoding validates rather than trusts: a payload that does not match the shape
 *     is rejected, and individual fields that are merely wrong-typed are dropped
 *     instead of being handed to the UI.
 */
import pako from 'pako'

/** Marks a code as ours, so a PoB code pasted into the same box is not misread. */
export const SHARE_PREFIX = 'P2C1.'

export interface ShareItem {
  /** The full item text as the client writes it, which is what re-parses later. */
  text: string
  slot: string | null
}

export interface ShareGem {
  name: string
  level: number | null
  quality: number | null
  enabled: boolean
}

export interface ShareSkillGroup {
  label: string | null
  gems: ShareGem[]
}

/** Everything a share code carries. Deliberately has no credential field. */
export interface ShareSnapshot {
  v: 1
  realm: string | null
  league: string | null
  level: number | null
  className: string | null
  ascendClassName: string | null
  treeVersion: string | null
  passiveNodes: number[]
  /** Campaign quest points, which move the level's point ceiling. */
  questPoints: number | null
  /** Atlas passive node hashes. */
  atlasNodes: number[]
  items: ShareItem[]
  skills: ShareSkillGroup[]
}

export class ShareCodeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'ShareCodeError'
  }
}

export function emptySnapshot(): ShareSnapshot {
  return {
    v: 1,
    realm: null,
    league: null,
    level: null,
    className: null,
    ascendClassName: null,
    treeVersion: null,
    passiveNodes: [],
    questPoints: null,
    atlasNodes: [],
    items: [],
    skills: [],
  }
}

/** True when this looks like one of ours, so a caller can route it. */
export function isShareCode(code: string): boolean {
  return code.trim().startsWith(SHARE_PREFIX)
}

// -------------------------------------------------------------- base64url bytes

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b == null) break
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c == null) break
    out += B64[c & 63]
  }
  return out
}

function base64UrlToBytes(text: string): Uint8Array | null {
  const lookup = new Map<string, number>()
  for (let i = 0; i < B64.length; i++) lookup.set(B64[i], i)
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const ch of text) {
    const value = lookup.get(ch)
    // A character outside the alphabet means this is not one of our codes.
    if (value == null) return null
    acc = (acc << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

// ------------------------------------------------------------------------ encode

/**
 * Encode a snapshot as a code.
 *
 * Field order is fixed and empty fields are omitted, so two snapshots that differ
 * only in what was left out produce different codes but the same decoded state —
 * and, more usefully, the same state always produces the same code.
 */
export function encodeShareSnapshot(snapshot: ShareSnapshot): string {
  const payload: Record<string, unknown> = { v: 1 }
  if (snapshot.realm) payload.realm = snapshot.realm
  if (snapshot.league) payload.league = snapshot.league
  if (snapshot.level != null) payload.level = snapshot.level
  if (snapshot.className) payload.className = snapshot.className
  if (snapshot.ascendClassName) payload.ascendClassName = snapshot.ascendClassName
  if (snapshot.treeVersion) payload.treeVersion = snapshot.treeVersion
  if (snapshot.passiveNodes.length) payload.nodes = snapshot.passiveNodes
  if (snapshot.questPoints != null) payload.questPoints = snapshot.questPoints
  if (snapshot.atlasNodes.length) payload.atlas = snapshot.atlasNodes
  if (snapshot.items.length) payload.items = snapshot.items
  if (snapshot.skills.length) payload.skills = snapshot.skills

  const json = JSON.stringify(payload)
  const deflated = pako.deflate(new TextEncoder().encode(json))
  return SHARE_PREFIX + bytesToBase64Url(deflated)
}

// ------------------------------------------------------------------------ decode

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Positive integers only: these are node ids and hashes, and 0 is not one. */
function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  for (const entry of value) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry > 0) seen.add(entry)
  }
  return [...seen].sort((a, b) => a - b)
}

function asItems(value: unknown): ShareItem[] {
  if (!Array.isArray(value)) return []
  const out: ShareItem[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      // A bare string is an item with no slot, which is how an older code would
      // have written it; accepting both means a format tweak does not break codes.
      if (entry.trim()) out.push({ text: entry, slot: null })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const text = asString(record.text)
    if (!text) continue
    out.push({ text, slot: asString(record.slot) })
  }
  return out
}

function asSkills(value: unknown): ShareSkillGroup[] {
  if (!Array.isArray(value)) return []
  const out: ShareSkillGroup[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const gems: ShareGem[] = []
    if (Array.isArray(record.gems)) {
      for (const gem of record.gems) {
        if (!gem || typeof gem !== 'object') continue
        const g = gem as Record<string, unknown>
        const name = asString(g.name)
        if (!name) continue
        gems.push({
          name,
          level: asNumber(g.level),
          quality: asNumber(g.quality),
          enabled: g.enabled !== false,
        })
      }
    }
    out.push({ label: asString(record.label), gems })
  }
  return out
}

/**
 * Decode a code back into a snapshot.
 *
 * Throws only when the code is not ours at all or is not readable — a corrupt
 * payload, a truncated paste, something that was never one of our codes. A payload
 * that decodes but has a wrong-typed field is repaired field by field instead,
 * because losing one field is better than losing the whole hand-off.
 */
export function decodeShareSnapshot(code: string): ShareSnapshot {
  const trimmed = code.trim()
  if (!isShareCode(trimmed)) {
    throw new ShareCodeError('这不是本工具的分享码(开头不是 ' + SHARE_PREFIX + ')')
  }
  const body = trimmed.slice(SHARE_PREFIX.length).replace(/\s+/g, '')
  const bytes = base64UrlToBytes(body)
  if (!bytes || bytes.length === 0) throw new ShareCodeError('分享码不是有效的 base64 内容')

  let json: string
  try {
    json = new TextDecoder('utf-8').decode(pako.inflate(bytes))
  } catch (cause) {
    throw new ShareCodeError('分享码解压失败 —— 多半是复制时被截断了', cause)
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (cause) {
    throw new ShareCodeError('分享码内容不是 JSON', cause)
  }
  if (!raw || typeof raw !== 'object') throw new ShareCodeError('分享码内容为空')

  const record = raw as Record<string, unknown>
  const version = asNumber(record.v)
  if (version !== 1) {
    throw new ShareCodeError(`分享码版本是 ${version ?? '未知'},本工具只认版本 1`)
  }

  return {
    v: 1,
    realm: asString(record.realm),
    league: asString(record.league),
    level: asNumber(record.level),
    className: asString(record.className),
    ascendClassName: asString(record.ascendClassName),
    treeVersion: asString(record.treeVersion),
    passiveNodes: asIdList(record.nodes),
    questPoints: asNumber(record.questPoints),
    atlasNodes: asIdList(record.atlas),
    items: asItems(record.items),
    skills: asSkills(record.skills),
  }
}
