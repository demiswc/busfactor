import { body, json, publicRoute } from '@/lib/api'
import { loginWithRecovery } from '@/lib/twofactor'

export const POST = publicRoute(async req => { await loginWithRecovery(String((await body<{ code: string }>(req)).code ?? '')); return json({ ok: true }) })
