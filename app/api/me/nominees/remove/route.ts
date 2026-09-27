import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { removeNominee } from '@/lib/engine/service'

export const POST = sudoRoute(async (req, user) => {
  const b = await body<{ id: string }>(req)
  await removeNominee(user.id, String(b.id ?? ''))
  return json({ ok: true })
})
