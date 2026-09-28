import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { body, json, publicRoute } from '@/lib/api'
import { checkInWithLink } from '@/lib/engine/service'
import { checkinWithPasskey } from '@/lib/twofactor'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string; response: AuthenticationResponseJSON; via?: string }>(req)
  const t = String(b.t ?? '')
  const { keyName } = await checkinWithPasskey(t, b.response)
  const r = await checkInWithLink(t, `${b.via === 'phone' ? 'phone notification' : 'email link'}, confirmed with passkey "${keyName}"`)
  return r.ok ? json({ ok: true, name: r.name }) : json({ ok: false, message: 'This check-in link has already been used or has expired. Please log in instead.' }, 400)
})
