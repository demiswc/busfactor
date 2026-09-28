import { authedRoute, json } from '@/lib/api'
import { testPush } from '@/lib/engine/service'

export const POST = authedRoute(async (_req, user) => json({ ok: true, ...(await testPush(user.id)) }))
