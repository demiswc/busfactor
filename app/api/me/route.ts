import { authedRoute, body, json, sudoRoute } from '@/lib/api'
import { getStatus, updateSettings, type SettingsInput } from '@/lib/engine/service'
import { REAUTH_WINDOW_MS } from '@/lib/auth'

export const GET = authedRoute(async (_req, user) => json({
  ...(await getStatus(user.id)),
  confirmedUntil: user.reauthAt ? new Date(user.reauthAt.getTime() + REAUTH_WINDOW_MS) : null,
}), false)

export const PUT = sudoRoute(async (req, user) => {
  const b = await body<SettingsInput>(req)
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))
  return json(await updateSettings(user.id, {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
    reminder1AfterDays: num(b.reminder1AfterDays),
    reminder2AfterDays: num(b.reminder2AfterDays),
    nomineeAlertAfterDays: num(b.nomineeAlertAfterDays),
    requiredConfirmations: num(b.requiredConfirmations),
    nomineeReminderHours: num(b.nomineeReminderHours),
    nomineeFinalHours: num(b.nomineeFinalHours),
    holdHours: num(b.holdHours),
    pausedUntil: b.pausedUntil === undefined ? undefined : (b.pausedUntil || null),
    reminder1Email: typeof b.reminder1Email === 'boolean' ? b.reminder1Email : undefined,
  }))
})
