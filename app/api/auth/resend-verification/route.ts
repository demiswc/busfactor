import { authedRoute, json } from '@/lib/api'
import { resendVerification } from '@/lib/accounts'

export const POST = authedRoute(async (_req, user) => {
  await resendVerification(user.id)
  return json({ ok: true })
})
