import { authedRoute, json } from '@/lib/api'
import { sendTestEmails } from '@/lib/engine/service'

export const POST = authedRoute(async (_req, user) => json(await sendTestEmails(user.id)))
