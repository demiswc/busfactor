import { body, json, publicRoute } from '@/lib/api'
import { checkInWithLink } from '@/lib/engine/service'

export const POST = publicRoute(async req => {
  const r = await checkInWithLink(String((await body<{ t: string }>(req)).t ?? ''))
  return r.ok ? json({ ok: true, name: r.name }) : json({ ok: false, message: 'This check-in link has already been used or has expired. Please log in instead.' }, 400)
})
