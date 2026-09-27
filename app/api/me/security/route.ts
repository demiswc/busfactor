import { authedRoute, body, json } from '@/lib/api'
import { requirePassword } from '@/lib/accounts'
import {
  passkeyRegisterOptions, passkeyRegisterVerify, regenerateRecoveryCodes, removePasskey, setEmailOtp, totpBegin, totpConfirm, totpDisable,
} from '@/lib/twofactor'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'

/**
 * Security settings. Every change that weakens or adds a way in asks for the password again,
 * so a stolen session alone cannot change them.
 */
type B = {
  action: 'totp-begin' | 'totp-confirm' | 'totp-disable' | 'email-otp' | 'passkey-options' | 'passkey-verify' | 'passkey-remove' | 'recovery'
  password?: string; setupId?: string; code?: string; on?: boolean; id?: string; name?: string; response?: RegistrationResponseJSON
}

export const POST = authedRoute(async (req, user) => {
  const b = await body<B>(req)
  const needPw = ['totp-begin', 'totp-disable', 'email-otp', 'passkey-options', 'passkey-remove', 'recovery']
  if (needPw.includes(b.action)) await requirePassword(user.id, String(b.password ?? ''))
  switch (b.action) {
    case 'totp-begin': return json({ ok: true, ...(await totpBegin(user.id, user.email)) })
    case 'totp-confirm': return json({ ok: true, ...(await totpConfirm(user.id, String(b.setupId ?? ''), String(b.code ?? ''))) })
    case 'totp-disable': await totpDisable(user.id); return json({ ok: true })
    case 'email-otp': await setEmailOtp(user.id, b.on === true); return json({ ok: true })
    case 'passkey-options': return json({ ok: true, options: await passkeyRegisterOptions(user.id, user.name, user.email) })
    case 'passkey-verify': return json({ ok: true, ...(await passkeyRegisterVerify(user.id, b.response as RegistrationResponseJSON, String(b.name ?? ''))) })
    case 'passkey-remove': await removePasskey(user.id, String(b.id ?? '')); return json({ ok: true })
    case 'recovery': return json({ ok: true, recoveryCodes: await regenerateRecoveryCodes(user.id) })
    default: return json({ error: 'Unknown action.' }, 400)
  }
})
