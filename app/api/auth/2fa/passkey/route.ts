import { body, json, publicRoute } from '@/lib/api'
import { loginWithPasskey, passkeyLoginOptions } from '@/lib/twofactor'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/** { options: true } returns a WebAuthn challenge; { response } verifies it. */
export const POST = publicRoute(async req => {
  const b = await body<{ options?: boolean; response?: AuthenticationResponseJSON }>(req)
  if (b.options) return json({ ok: true, options: await passkeyLoginOptions() })
  await loginWithPasskey(b.response as AuthenticationResponseJSON)
  return json({ ok: true })
})
