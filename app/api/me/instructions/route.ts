import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { setInstructions } from '@/lib/engine/service'

export const PUT = sudoRoute(async (req, user) => {
  const b = await body<{ mode: 'NONE' | 'SERVER' | 'SEALED'; text?: string; sealed?: string; hint?: string }>(req, 1024 * 1024)
  if (!['NONE', 'SERVER', 'SEALED'].includes(b.mode)) return json({ error: 'Unknown mode.' }, 400)
  await setInstructions(user.id, b)
  return json({ ok: true })
})
