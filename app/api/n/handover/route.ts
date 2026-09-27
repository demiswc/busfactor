import { body, clientIp, json, publicRoute } from '@/lib/api'
import { rateLimit } from '@/lib/auth'
import { openHandover } from '@/lib/engine/service'

export const POST = publicRoute(async req => {
  if (!(await rateLimit(`handover:${clientIp(req)}`, 30, 60 * 60 * 1000))) return json({ ok: false, message: 'Too many attempts. Please wait an hour.' }, 429)
  const b = await body<{ t: string }>(req)
  return json(await openHandover(String(b.t ?? '')))
})
