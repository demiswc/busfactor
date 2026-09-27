import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { deleteMessage, setMessage } from '@/lib/engine/service'

export const PUT = sudoRoute(async (req, user) => {
  const b = await body<{ nomineeId: string; box: string; sizeBytes: number }>(req, 31 * 1024 * 1024)
  await setMessage(user.id, String(b.nomineeId ?? ''), String(b.box ?? ''), Number(b.sizeBytes ?? 0))
  return json({ ok: true })
})

export const POST = sudoRoute(async (req, user) => {
  const b = await body<{ nomineeId: string }>(req)
  await deleteMessage(user.id, String(b.nomineeId ?? ''))
  return json({ ok: true })
})
