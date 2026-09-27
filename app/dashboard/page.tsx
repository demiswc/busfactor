import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getStatus } from '@/lib/engine/service'
import { Card, H1, H2, Muted, Notice } from '@/components/ui'
import { CheckInButton, ResendVerification } from '@/components/CheckIn'
import { eventLabel } from '@/lib/eventLabels'

export const dynamic = 'force-dynamic'

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const STAGE_TEXT: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  ACTIVE: { label: 'All good', tone: 'ok' },
  REMINDER_1: { label: 'Check-in due: first reminder sent', tone: 'warn' },
  REMINDER_2: { label: 'Overdue: second reminder sent', tone: 'warn' },
  NOMINEES_ALERTED: { label: 'Your contacts are being asked if you are OK', tone: 'error' },
  HOLD: { label: 'Handover is about to be sent', tone: 'error' },
  HANDOVER_SENT: { label: 'Your handover link has been sent', tone: 'error' },
}

export default async function Dashboard() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/dashboard')
  const st = await getStatus(user.id)
  const s = st.settings
  const accepted = st.nominees.filter(n => n.status === 'ACCEPTED')
  const confirmers = accepted.filter(n => n.role === 'CONFIRMER').length
  const trusted = accepted.filter(n => n.role === 'TRUSTED').length
  const stage = STAGE_TEXT[s.stage] ?? STAGE_TEXT.ACTIVE
  const urgent = s.stage !== 'ACTIVE'

  const checklist = [
    { done: st.user.verified, text: 'Confirm your email address' },
    { done: confirmers >= 2, text: `Invite two people who would notice if you went quiet (${confirmers}/2 accepted)` },
    { done: trusted >= 1, text: 'Invite the person who should receive your handover' },
    { done: st.hasInstructions || st.nominees.some(n => n.message), text: 'Leave handover instructions or a personal message' },
    { done: st.security.passkeys.length > 0 || st.security.totp || st.security.emailOtp, text: 'Protect your login with a passkey, authenticator app or email codes' },
    { done: s.enabled, text: 'Switch it on' },
    { done: st.events.some(e => e.type === 'TEST_EMAILS_SENT'), text: 'Send yourself the test emails' },
  ]
  const remaining = checklist.filter(c => !c.done).length

  return (
    <div className="space-y-6">
      <H1>Hello, {user.name}</H1>
      {s.enabled && !st.scheduler.healthy && (
        <Notice tone="error">The scheduler that sends reminders has not run recently{st.scheduler.lastTickAt ? ` (last run ${fmt(st.scheduler.lastTickAt)})` : ''}. Reminders and alerts may be delayed. If you run this site, check the busfactor-tick timer.</Notice>
      )}
      {!st.user.verified && <Notice tone="warn">Please confirm your email address before setting up your switch. <ResendVerification /></Notice>}

      <Card className={urgent ? 'border-red-300 dark:border-red-800' : ''}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Notice tone={s.enabled ? stage.tone : 'info'}>{s.enabled ? stage.label : 'Your switch is off'}</Notice>
            <Muted>Last check-in: <strong>{fmt(s.lastCheckinAt)}</strong>{s.lastCheckinAt ? ` (${st.daysSinceCheckin} days ago)` : ''}</Muted>
            {s.enabled && s.stage === 'ACTIVE' && !st.paused && <Muted>First reminder due: {fmt(st.schedule.reminder1At)}</Muted>}
            {st.paused && <Muted>Paused until {fmt(s.pausedUntil)}</Muted>}
            {s.stage === 'NOMINEES_ALERTED' && (
              <Muted>“Not OK” answers so far: {st.notOkCount}. {st.schedule.nomineeReminderAt ? `Silent contacts are reminded ${fmt(st.schedule.nomineeReminderAt)}.` : st.schedule.goAheadAt ? `Handover starts ${fmt(st.schedule.goAheadAt)} unless someone says you are OK.` : ''}</Muted>
            )}
            {s.stage === 'HOLD' && <Muted>Handover will be sent {fmt(s.holdEndsAt)}. Checking in cancels it.</Muted>}
          </div>
          <CheckInButton urgent={urgent} />
        </div>
      </Card>

      {remaining > 0 && (
        <Card>
          <H2>Set up ({checklist.length - remaining}/{checklist.length})</H2>
          <ul className="space-y-2 text-sm">
            {checklist.map(c => (
              <li key={c.text} className="flex gap-3">
                <span aria-hidden className={c.done ? 'text-emerald-600' : 'text-black/30 dark:text-white/30'}>{c.done ? '✓' : '○'}</span>
                <span className={c.done ? 'text-black/50 line-through dark:text-white/40' : ''}>{c.text}</span>
              </li>
            ))}
          </ul>
          <Link href="/settings" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">Go to settings →</Link>
        </Card>
      )}

      <Card>
        <H2>Recent activity</H2>
        {st.events.length === 0 ? <Muted>Nothing yet.</Muted> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
            {st.events.slice(0, 12).map(e => (
              <li key={e.id} className="flex justify-between gap-4 py-2">
                <span>{eventLabel(e.type)}{e.detail ? <span className="text-black/60 dark:text-white/60">: {e.detail}</span> : null}</span>
                <span className="shrink-0 text-black/50 dark:text-white/50">{fmt(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
