import { body, json, publicRoute } from '@/lib/api'
import { checkinPasskeyOptions } from '@/lib/twofactor'

/** Passkey options for "check in with Face ID". { options: null } when the owner has no passkeys. */
export const POST = publicRoute(async req => {
  const b = await body<{ t: string }>(req)
  return json({ options: await checkinPasskeyOptions(String(b.t ?? '')) })
})
