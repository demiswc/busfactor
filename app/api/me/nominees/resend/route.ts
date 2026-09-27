import { authedRoute, body, json } from '@/lib/api'
import { rateLimit } from '@/lib/auth'
import { resendInvite, UserError } from '@/lib/engine/service'

export const POST = authedRoute(async (req, user) => {
  if (!(await rateLimit(`invite:${user.id}`, 10, 24 * 60 * 60 * 1000))) throw new UserError('You have sent a lot of invitations today. Please try again tomorrow.')
  const b = await body<{ id: string }>(req)
  await resendInvite(user.id, String(b.id ?? ''))
  return json({ ok: true })
})
