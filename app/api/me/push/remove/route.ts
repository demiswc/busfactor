import { body, json, sudoRoute } from '@/lib/api'
import { removePushDevice } from '@/lib/engine/service'

export const POST = sudoRoute(async (req, user) => {
  const b = await body<{ id: string }>(req)
  await removePushDevice(user.id, String(b.id ?? ''))
  return json({ ok: true })
})
