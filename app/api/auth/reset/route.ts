import { body, json, publicRoute } from '@/lib/api'
import { resetPassword } from '@/lib/accounts'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string; password: string }>(req)
  await resetPassword(b.t, b.password)
  return json({ ok: true })
})
