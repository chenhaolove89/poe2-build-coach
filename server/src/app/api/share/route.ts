/**
 * POST /api/share —— upload a code, get a short id back.
 *
 * Accepts JSON {code, summary}; a bare text body (text/plain) is also read as the
 * code so the endpoint stays curl-able. The code passes the hygiene gate before
 * anything is stored; the summary is display data and is whitelisted, not trusted.
 */
import { NextResponse } from 'next/server'
import { TTL_MS, cleanSummary, newId, validCode } from '@/lib/share'
import { insertShare } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = { 'Access-Control-Allow-Origin': '*' }

// The desktop uploads through the Tauri HTTP plugin, which ignores CORS — the
// preflight handler exists for browser callers (dev preview, tests), where a
// JSON POST is not "simple" and dies without it.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  })
}

export async function POST(req: Request) {
  const raw = await req.text().catch(() => '')
  let payload: { code?: unknown; summary?: unknown } | null = null
  try {
    payload = JSON.parse(raw) as { code?: unknown; summary?: unknown }
  } catch {
    payload = null
  }
  const code = (payload && typeof payload.code === 'string' ? payload.code : raw) as unknown
  if (!validCode(code)) {
    return NextResponse.json({ ok: false, error: 'not a valid P2C1 share code' }, { status: 400, headers: CORS })
  }
  const summary = cleanSummary(payload?.summary)
  const now = Date.now()
  // Two attempts: an id collision is a one-in-hundreds-of-trillions event, and the
  // retry makes it a non-event entirely.
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = newId()
    try {
      await insertShare(id, code, summary ? JSON.stringify(summary) : null, now)
      return NextResponse.json({ ok: true, id, expiresAt: now + TTL_MS }, { headers: CORS })
    } catch {
      if (attempt === 1) {
        return NextResponse.json({ ok: false, error: 'storage unavailable' }, { status: 500, headers: CORS })
      }
    }
  }
  return NextResponse.json({ ok: false, error: 'storage unavailable' }, { status: 500, headers: CORS })
}
