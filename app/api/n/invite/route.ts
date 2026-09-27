import { body, json, publicRoute } from '@/lib/api'
import { answerInvite } from '@/lib/engine/service'

export const POST = publicRoute(async req => {
  const b = await body<{ t: string; accept: boolean; publicKey?: string; encPrivateKey?: string; hint?: string }>(req)
  return json(await answerInvite(String(b.t ?? ''), b.accept === true, { publicKey: b.publicKey, encPrivateKey: b.encPrivateKey, hint: b.hint }))
})
