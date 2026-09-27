import { body, json, publicRoute } from '@/lib/api'
import { loginWithEmailCode, sendLoginEmailCode } from '@/lib/twofactor'

/** { send: true } emails a code; { code } checks it. */
export const POST = publicRoute(async req => {
  const b = await body<{ send?: boolean; code?: string }>(req)
  if (b.send) { await sendLoginEmailCode(); return json({ ok: true, sent: true }) }
  await loginWithEmailCode(String(b.code ?? ''))
  return json({ ok: true })
})
