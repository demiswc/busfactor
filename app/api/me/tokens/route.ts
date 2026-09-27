import { authedRoute, body, json } from '@/lib/api'
import { requirePassword } from '@/lib/accounts'
import { createApiToken, revokeApiToken } from '@/lib/engine/service'

export const POST = authedRoute(async (req, user) => {
  const b = await body<{ name?: string; password?: string; revoke?: string }>(req)
  if (b.revoke) { await revokeApiToken(user.id, String(b.revoke)); return json({ ok: true }) }
  await requirePassword(user.id, String(b.password ?? ''))
  return json({ ok: true, token: await createApiToken(user.id, String(b.name ?? '')) })
})
