import { body, clientIp, json, publicRoute } from '@/lib/api'
import { signup } from '@/lib/accounts'

export const POST = publicRoute(async req => {
  const b = await body<{ name: string; email: string; password: string }>(req)
  await signup(b, clientIp(req))
  return json({ ok: true })
})
