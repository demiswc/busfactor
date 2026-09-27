import { type NextRequest } from 'next/server'
import { clientIp, fail, json } from '@/lib/api'
import { rateLimit } from '@/lib/auth'
import { checkInWithApiToken } from '@/lib/engine/service'

/**
 * Check in from a script or the CLI:
 *   curl -X POST -H "Authorization: Bearer bf_..." https://busfactor.co.uk/api/v1/checkin
 * Please run it by hand, not from cron: an automatic check-in keeps working after you are gone.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`api-checkin:${clientIp(req)}`, 30, 60 * 60 * 1000))) return fail('Too many requests.', 429)
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  try {
    const userId = await checkInWithApiToken(token)
    return userId ? json({ ok: true, checkedIn: new Date().toISOString() }) : fail('Invalid token.', 401)
  } catch (e) {
    console.error('[busfactor] api check-in failed', e)
    return fail('Something went wrong.', 500)
  }
}
