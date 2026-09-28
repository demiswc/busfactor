import { body, json, sudoRoute } from '@/lib/api'
import { addPushDevice } from '@/lib/engine/service'

/** Adds this phone or browser as a device that receives check-in reminders. Needs the password again. */
export const POST = sudoRoute(async (req, user) => {
  const b = await body<{ subscription: unknown; name: unknown }>(req)
  const r = await addPushDevice(user.id, b.subscription, b.name)
  return json({ ok: true, id: r.id })
})

