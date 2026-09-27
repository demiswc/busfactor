import { authedRoute, body, json } from '@/lib/api'
import { requirePassword } from '@/lib/accounts'
import { markReauth, REAUTH_WINDOW_MS } from '@/lib/auth'

/** Re-enter the password to allow sensitive changes for 15 minutes on this device. */
export const POST = authedRoute(async (req, user) => {
  await requirePassword(user.id, String((await body<{ password: string }>(req)).password ?? ''))
  await markReauth(user.sessionId)
  return json({ ok: true, confirmedUntil: new Date(Date.now() + REAUTH_WINDOW_MS) })
})
