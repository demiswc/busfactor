import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schedulerHealthy } from '@/lib/system'

export const dynamic = 'force-dynamic'

/** For uptime monitors. 200 when the database answers and the scheduler ran in the last 30 minutes. ?live=1 checks the database only. */
export async function GET(req: Request) {
  try {
    await db.$queryRawUnsafe('SELECT 1')
    if (new URL(req.url).searchParams.has('live')) return NextResponse.json({ ok: true, database: true }) // container liveness
    const s = await schedulerHealthy()
    return NextResponse.json({ ok: s.healthy, database: true, scheduler: s }, { status: s.healthy ? 200 : 503 })
  } catch {
    return NextResponse.json({ ok: false, database: false }, { status: 503 })
  }
}
