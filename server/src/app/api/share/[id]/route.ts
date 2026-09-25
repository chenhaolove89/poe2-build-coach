/**
 * GET /api/share/:id —— the JSON half of the read path.
 *
 * The desktop resolves a pasted link through here; the /s/:id page reads the
 * store directly and does not use this route. A read slides the expiry forward,
 * so a link people still open does not die of old age.
 */
import { NextResponse } from 'next/server'
import { ID_PATTERN } from '@/lib/share'
import { getShare, touchShare } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = { 'Access-Control-Allow-Origin': '*' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400, headers: CORS })
  }
  const row = await getShare(id)
  if (!row) {
    return NextResponse.json({ ok: false, error: 'link not found or expired' }, { status: 404, headers: CORS })
  }
  const expiresAt = await touchShare(id, Date.now())
  return NextResponse.json(
    {
      ok: true,
      code: row.code,
      summary: row.summary ? JSON.parse(row.summary) : null,
      expiresAt,
    },
    { headers: CORS },
  )
}
