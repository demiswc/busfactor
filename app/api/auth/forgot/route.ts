import { body, clientIp, json, publicRoute } from '@/lib/api'
import { forgotPassword } from '@/lib/accounts'

/** Always answers the same way, so it cannot be used to discover accounts. */
export const POST = publicRoute(async req => {
  const b = await body<{ email: string }>(req)
  await forgotPassword(b.email, clientIp(req))
  return json({ ok: true })
})
