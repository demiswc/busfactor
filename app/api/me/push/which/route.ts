import { authedRoute, body, json } from '@/lib/api'
import { findPushDevice } from '@/lib/engine/service'

/** Tells this browser whether its own notification subscription is one of the account's devices. */
export const POST = authedRoute(async (req, user) => {
  const b = await body<{ endpoint: unknown }>(req)
  return json({ id: await findPushDevice(user.id, b.endpoint) })
})
