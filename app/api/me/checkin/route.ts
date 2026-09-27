import { authedRoute, json } from '@/lib/api'
import { checkIn } from '@/lib/engine/service'

export const POST = authedRoute(async (_req, user) => {
  await checkIn(user.id, 'dashboard')
  return json({ ok: true })
})
