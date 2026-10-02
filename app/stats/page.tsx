import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { collectStats, hasSecondFactor, isOperatorAdmin, type Stats } from '@/lib/metrics'
import { Card, H1, Muted, Notice } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Stats', robots: { index: false, follow: false } }

/**
 * Operator stats: counts and timings only, never who. Visible only to the accounts listed in
 * OPERATOR_ADMIN_EMAILS, and only once that account has a second login step. Everyone else gets 404,
 * so the page does not even reveal that it exists.
 */
export default async function StatsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || !isOperatorAdmin(user)) notFound()
  if (!(await hasSecondFactor(user.id))) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <H1>Stats</H1>
        <Notice tone="warn">Turn on a second login step (passkey, authenticator app or email codes) in &ldquo;Protect your login&rdquo; to see the stats.</Notice>
      </div>
    )
  }
  const st = await collectStats()
  return <StatsView st={st} />
}

const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-GB'))
const ms = (v: number | null) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`)
const pc = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-black/55 dark:text-white/55">{sub}</p>}
    </div>
  )
}

function Bars({ title, values, days }: { title: string; values: number[]; days: string[] }) {
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-black/55 tabular-nums dark:text-white/55">{n(total)} in 30 days</p>
      </div>
      <div className="flex h-20 items-end gap-[3px]" role="img" aria-label={`${title}: ${total} in the last 30 days`}>
        {values.map((v, i) => (
          <div key={days[i]} title={`${days[i]}: ${v}`} className="flex-1 rounded-t bg-brand/80" style={{ height: `${v ? Math.max(4, (v / max) * 100) : 1}%`, opacity: v ? 1 : 0.25 }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-white/45"><span>{days[0].slice(5)}</span><span>today</span></div>
    </div>
  )
}

const VITAL_HELP: Record<string, { label: string; good: number; poor: number }> = {
  TTFB: { label: 'Server response (TTFB)', good: 800, poor: 1800 },
  FCP: { label: 'First paint (FCP)', good: 1800, poor: 3000 },
  LCP: { label: 'Page loaded (LCP)', good: 2500, poor: 4000 },
  INP: { label: 'Responsiveness (INP)', good: 200, poor: 500 },
  CLS: { label: 'Layout shift (CLS × 1000)', good: 100, poor: 250 },
}

function StatsView({ st }: { st: Stats }) {
  const u = st.users, s = st.switches, e = st.email
  const stages = ['ACTIVE', 'REMINDER_1', 'REMINDER_2', 'NOMINEES_ALERTED', 'HOLD', 'HANDOVER_SENT']
  const stageLabel: Record<string, string> = { ACTIVE: 'All good', REMINDER_1: 'First reminder sent', REMINDER_2: 'Second reminder sent', NOMINEES_ALERTED: 'Contacts being asked', HOLD: 'Safety wait', HANDOVER_SENT: 'Handover sent' }
  const failRate = e.sent7d + e.failed7d ? e.failed7d / (e.sent7d + e.failed7d) : 0
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <H1>Stats</H1>
          <Muted>Counts and timings only: no names, emails or addresses. Updated {new Date(st.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</Muted>
        </div>
        <p className="text-xs text-black/50 dark:text-white/50">v{st.server.version}{st.server.commit ? ` · ${st.server.commit}` : ''} · Node {st.server.nodeVersion}</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">People</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Users" value={n(u.total)} sub={`${n(u.verified)} confirmed their email`} />
          <Tile label="New" value={n(u.new7d)} sub={`${n(u.new24h)} today · ${n(u.new30d)} in 30 days`} />
          <Tile label="Logged in" value={n(u.loggedIn7d)} sub={`this week · ${n(u.loggedIn30d)} in 30 days`} />
          <Tile label="Checked in" value={n(u.checkedIn30d)} sub="in the last 30 days" />
          <Tile label="Second login step" value={pc(u.with2fa, u.total)} sub={`${n(u.with2fa)} accounts`} />
          <Tile label="Phone reminders" value={n(u.withPhoneReminders)} sub="accounts with a phone" />
          <Tile label="Deleted accounts" value={n(u.deleted30d)} sub="in the last 30 days" />
          <Tile label="Contacts" value={n(st.contacts.confirmersAccepted + st.contacts.trustedAccepted)} sub={`${n(st.contacts.pending)} invitations waiting · ${n(st.contacts.declined)} declined`} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">Switches</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <Card className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Switched on</span><span className="font-semibold tabular-nums">{n(s.on)}</span></div>
            <div className="flex justify-between"><span>Paused</span><span className="tabular-nums">{n(s.paused)}</span></div>
            <hr className="border-black/10 dark:border-white/10" />
            {stages.map(k => (
              <div key={k} className="flex justify-between">
                <span className={k === 'NOMINEES_ALERTED' || k === 'HOLD' || k === 'HANDOVER_SENT' ? 'text-red-700 dark:text-red-300' : ''}>{stageLabel[k]}</span>
                <span className="tabular-nums">{n(s.byStage[k] ?? 0)}</span>
              </div>
            ))}
          </Card>
          <Card className="space-y-2 text-sm">
            <p className="font-semibold">Last 30 days</p>
            <div className="flex justify-between"><span>Reminders sent</span><span className="tabular-nums">{n(st.escalations30d.reminders)}</span></div>
            <div className="flex justify-between"><span>Contacts asked &ldquo;are they OK?&rdquo;</span><span className="tabular-nums">{n(st.escalations30d.contactsAsked)}</span></div>
            <div className="flex justify-between"><span>Safety waits started</span><span className="tabular-nums">{n(st.escalations30d.holdsStarted)}</span></div>
            <div className="flex justify-between"><span>Handovers sent</span><span className="tabular-nums">{n(st.escalations30d.handoversSent)}</span></div>
            <hr className="border-black/10 dark:border-white/10" />
            <div className="flex justify-between"><span>Sealed instructions</span><span className="tabular-nums">{n(s.instructions.SEALED ?? 0)}</span></div>
            <div className="flex justify-between"><span>Personal messages</span><span className="tabular-nums">{n(s.personalMessages)}</span></div>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">Email and notifications</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Emails today" value={n(e.sent24h)} />
          <Tile label="Emails this week" value={n(e.sent7d)} sub={`${n(e.sent30d)} in 30 days`} />
          <Tile label="Failed this week" value={n(e.failed7d)} sub={`${(failRate * 100).toFixed(1)}% of attempts`} tone={failRate > 0.05 ? 'bad' : failRate > 0 ? 'warn' : undefined} />
          <Tile label="Phone notifications" value={n(st.push.sent30d)} sub={`30 days · ${n(st.push.failed30d)} failed`} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">Daily activity</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Bars title="Sign-ups" values={st.daily.signups} days={st.daily.days} />
          <Bars title="Logins" values={st.daily.logins} days={st.daily.days} />
          <Bars title="Check-ins" values={st.daily.checkins} days={st.daily.days} />
          <Bars title="Emails sent" values={st.daily.emailsSent} days={st.daily.days} />
          <Bars title="Emails failed" values={st.daily.emailsFailed} days={st.daily.days} />
          <Bars title="Phone notifications" values={st.daily.pushesSent} days={st.daily.days} />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">Page load times</h2>
        <Muted className="mb-3">Measured in visitors&apos; browsers over the last 7 days. 75th percentile is what Google uses: 3 in 4 visits are this fast or faster.</Muted>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-black/50 dark:text-white/50">
              <tr><th className="px-4 py-3">Measure</th><th className="px-4 py-3 text-right">Typical (p50)</th><th className="px-4 py-3 text-right">p75</th><th className="px-4 py-3 text-right">Slowest (p95)</th><th className="px-4 py-3 text-right">Samples</th></tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/10">
              {st.performance.perf.map(p => {
                const h = VITAL_HELP[p.metric]
                const tone = p.p75 == null ? '' : p.p75 <= h.good ? 'text-emerald-700 dark:text-emerald-300' : p.p75 <= h.poor ? 'text-amber-600' : 'text-red-600'
                const fmt = (v: number | null) => (p.metric === 'CLS' ? n(v) : ms(v))
                return (
                  <tr key={p.metric}>
                    <td className="px-4 py-2">{h.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(p.p50)}</td>
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${tone}`}>{fmt(p.p75)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(p.p95)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-black/55 dark:text-white/55">{n(p.samples)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
        {st.performance.lcpByPage.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {st.performance.lcpByPage.map(p => (
              <span key={p.page} className="rounded-full border border-black/10 px-3 py-1 dark:border-white/10">{p.page}: <strong className="tabular-nums">{ms(p.p75)}</strong> <span className="text-black/50 dark:text-white/50">({p.samples})</span></span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">Server</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Scheduler" value={st.server.schedulerHealthy ? 'Running' : 'Not running'} tone={st.server.schedulerHealthy ? undefined : 'bad'}
            sub={st.server.lastTickAt ? `last run ${new Date(st.server.lastTickAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'never run'} />
          <Tile label="Scheduler run time" value={ms(st.server.avgTickMs7d)} sub={`average of ${n(st.server.ticks7d)} runs this week`} />
          <Tile label="Database" value={ms(st.server.dbPingMs)} sub="response time now" tone={st.server.dbPingMs > 200 ? 'warn' : undefined} />
          <Tile label="App process" value={`${st.server.memoryMb} MB`} sub={`up ${st.server.uptimeHours} hours`} />
        </div>
      </section>
    </div>
  )
}
