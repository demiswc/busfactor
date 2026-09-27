import { authedRoute, body, json } from '@/lib/api'
import { changePassword } from '@/lib/accounts'

export const POST = authedRoute(async (req, user) => {
  const b = await body<{ current: string; next: string }>(req)
  await changePassword(user.id, b.current, b.next)
  return json({ ok: true })
})
