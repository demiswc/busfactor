import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { rateLimit } from '@/lib/auth'
import { addNominee, UserError } from '@/lib/engine/service'

export const POST = sudoRoute(async (req, user) => {
  if (!(await rateLimit(`invite:${user.id}`, 10, 24 * 60 * 60 * 1000))) throw new UserError('You have sent a lot of invitations today. Please try again tomorrow.')
  const b = await body<{ name: string; email: string; role: string }>(req)
  return json({ ok: true, id: await addNominee(user.id, b) })
})
