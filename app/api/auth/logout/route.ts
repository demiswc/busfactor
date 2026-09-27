import { json, publicRoute } from '@/lib/api'
import { destroySession } from '@/lib/auth'

export const POST = publicRoute(async () => {
  await destroySession()
  return json({ ok: true })
})
