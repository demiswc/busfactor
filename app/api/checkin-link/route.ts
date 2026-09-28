import { body, json, publicRoute } from '@/lib/api'
import { checkInWithLink } from '@/lib/engine/service'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string; via?: string }>(req)
  const r = await checkInWithLink(String(b.t ?? ''), b.via === 'phone' ? 'phone notification' : 'email link')
  return r.ok ? json({ ok: true, name: r.name }) : json({ ok: false, message: 'This check-in link has already been used or has expired. Please log in instead.' }, 400)
})
