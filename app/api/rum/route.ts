import { body, clientIp, json, publicRoute, rateKeyForIp } from '@/lib/api'
import { rateLimit } from '@/lib/auth'
import { recordPerf } from '@/lib/metrics'

/** Page-load timings from visitors' browsers (Web Vitals). Stored as numbers only: no user, no IP. */
export const POST = publicRoute(async req => {
  const b = await body<{ name?: unknown; value?: unknown; page?: unknown }>(req, 2048)
  if (await rateLimit(`rum:${rateKeyForIp(clientIp(req))}`, 60, 60 * 60 * 1000)) await recordPerf(b.name, b.value, b.page)
  return json({ ok: true })
})
