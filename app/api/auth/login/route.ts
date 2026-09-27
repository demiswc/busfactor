import { body, clientIp, json, publicRoute } from '@/lib/api'
import { login } from '@/lib/accounts'

export const POST = publicRoute(async req => {
  const b = await body<{ email: string; password: string }>(req)
  return json({ ok: true, ...(await login(b, clientIp(req))) })
})
