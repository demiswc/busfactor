import { body, json, publicRoute } from '@/lib/api'
import { respond } from '@/lib/engine/service'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string; answer: string }>(req)
  if (b.answer !== 'OK' && b.answer !== 'NOT_OK') return json({ ok: false, message: 'Unknown answer.' }, 400)
  return json(await respond(String(b.t ?? ''), b.answer))
})
