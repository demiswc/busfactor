import { body, json, publicRoute } from '@/lib/api'
import { loginWithTotp } from '@/lib/twofactor'

export const POST = publicRoute(async req => { await loginWithTotp(String((await body<{ code: string }>(req)).code ?? '')); return json({ ok: true }) })
