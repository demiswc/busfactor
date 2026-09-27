import { NextResponse, type NextRequest } from 'next/server'
import { safeEqual } from '@/lib/crypto'
import { tickAll } from '@/lib/engine/service'

export const dynamic = 'force-dynamic'

/**
 * Scheduler hook. Run every 5–15 minutes from cron on the server:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/tick
 * Answers 404 unless the secret matches (and refuses entirely if CRON_SECRET is unset or short).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || ''
  if (secret.length < 24 || !safeEqual(req.headers.get('x-cron-secret') || '', secret)) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await tickAll()) })
  } catch (e) {
    console.error('[busfactor] tick failed', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
