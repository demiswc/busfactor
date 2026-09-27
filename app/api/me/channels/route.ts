import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { setChannels, testChannels } from '@/lib/engine/service'

export const PUT = sudoRoute(async (req, user) => {
  const b = await body<{ channels: Array<{ label?: string; url: string }> }>(req)
  await setChannels(user.id, Array.isArray(b.channels) ? b.channels : [])
  return json({ ok: true })
})

export const POST = authedRoute(async (_req, user) => json({ ok: true, results: await testChannels(user.id) }))
