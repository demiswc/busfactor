import { authedRoute, body, json } from '@/lib/api'
import { deleteAccount } from '@/lib/accounts'
import { destroySession } from '@/lib/auth'

export const POST = authedRoute(async (req, user) => {
  const b = await body<{ password: string }>(req)
  await deleteAccount(user.id, b.password)
  await destroySession()
  return json({ ok: true })
})
