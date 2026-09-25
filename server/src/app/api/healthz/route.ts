/** GET /api/healthz —— deployment acceptance probe. */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, now: Date.now() })
}
