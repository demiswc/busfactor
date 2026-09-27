import { body, fail, json, publicRoute } from '@/lib/api'
import { verifyEmail } from '@/lib/accounts'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string }>(req)
  return (await verifyEmail(b.t)) ? json({ ok: true }) : fail('This confirmation link is not valid or has already been used.')
})
