import pako from 'pako'
import { PobParseError } from '../types.js'

/**
 * PoB share codes are base64 of a zlib-deflated XML document.
 * The alphabet varies across exporters (standard vs url-safe, with/without
 * padding, some wrap lines), so decoding is deliberately tolerant.
 */
export function decodeShareCode(code: string): string {
  const cleaned = code.trim().replace(/\s+/g, '')
  if (cleaned.length === 0) {
    throw new PobParseError('Empty share code')
  }

  const candidates = new Set<string>([cleaned])
  candidates.add(cleaned.replace(/-/g, '+').replace(/_/g, '/'))
  candidates.add(cleaned.replace(/\+/g, '-').replace(/\//g, '_'))

  let lastError: unknown
  for (const candidate of candidates) {
    const bytes = base64ToBytes(candidate)
    if (!bytes || bytes.length === 0) continue
    const xml = inflateBytes(bytes)
    if (xml) return xml
    lastError = 'deflate failed'
  }
  throw new PobParseError('Share code could not be decoded (not base64+zlib XML?)', lastError)
}

function inflateBytes(bytes: Uint8Array): string | null {
  for (const inflate of [pako.inflate, pako.inflateRaw]) {
    try {
      return new TextDecoder('utf-8').decode(inflate(bytes))
    } catch {
      // try next strategy
    }
  }
  return null
}

/** Tolerant base64 decode: fixes padding, returns null on foreign characters. */
function base64ToBytes(b64: string): Uint8Array | null {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Inverse of decodeShareCode — used by tests and by future "re-share" features. */
export function encodeShareCode(xml: string): string {
  const bytes = pako.deflate(new TextEncoder().encode(xml))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
