'use client'
/**
 * The logged-in dashboard: setup steps on the left, the chosen step in the middle,
 * the switch's status (and the "I'm OK" button) on the right.
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/client'
import { eventLabel } from '@/lib/eventLabels'
import { Muted, Notice } from '@/components/ui'
import { CheckInButton, ResendVerification } from '@/components/CheckIn'
import { Account, Contacts, Instructions, ReauthBar, TestEmails, Timers, type Status } from '@/app/settings/SettingsClient'
import { AlertChannels, CheckinTokens, PersonalMessages, Security } from '@/components/settings/Sections'
import { PhoneReminders } from '@/components/workspace/Phone'
import { WalkthroughVideo } from '@/components/WalkthroughVideo'

type StepId = 'overview' | 'email' | 'login' | 'phone' | 'people' | 'messages' | 'instructions' | 'switch' | 'test' | 'channels' | 'terminal' | 'activity' | 'account'

interface Step {
  id: StepId
  group: string
  title: string
  done?: boolean
  optional?: boolean
  why: string
  how?: string[]
  needsPassword?: boolean
}

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const STAGE: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' }> = {
  ACTIVE: { label: 'All good', tone: 'ok' },
  REMINDER_1: { label: 'Check-in due', tone: 'warn' },
  REMINDER_2: { label: 'Overdue: second reminder sent', tone: 'warn' },
  NOMINEES_ALERTED: { label: 'Your contacts are being asked if you are OK', tone: 'error' },
  HOLD: { label: 'Handover is about to be sent', tone: 'error' },
  HANDOVER_SENT: { label: 'Your handover link has been sent', tone: 'error' },
}

function buildSteps(st: Status): { setup: Step[]; more: Step[] } {
  const accepted = st.nominees.filter(n => n.status === 'ACCEPTED')
  const confirmers = accepted.filter(n => n.role === 'CONFIRMER').length
  const trusted = accepted.filter(n => n.role === 'TRUSTED')
  const sec = st.security
  const setup: Step[] = [
    {
      id: 'email', group: 'Your account', title: 'Confirm your email', done: st.user.verified,
      why: 'Reminders go to this address, and your contacts need to know the invitations really come from you.',
      how: ['Open the email we sent you.', 'Press "Confirm email".'],
    },
    {
      id: 'login', group: 'Your account', title: 'Protect your login', done: sec.passkeys.length > 0 || sec.totp || sec.emailOtp,
      why: 'Your account decides who gets your handover. A second step at login stops anyone who learns your password.',
      how: ['Enter your password in the box below.', 'Add a passkey or security key (strongest), an authenticator app, or email codes.', 'Keep the recovery codes somewhere safe.'],
    },
    {
      id: 'phone', group: 'Your account', title: 'Check in from your phone', optional: true, done: st.push.devices.length > 0,
      why: 'Get your check-in reminders as a notification on your phone instead of by email. Tap it, confirm it is you, done. No app to install: it works in your phone\'s browser, on iPhone and Android.',
    },
    {
      id: 'people', group: 'Your people', title: 'Choose your people', done: confirmers >= 2 && trusted.length >= 1, needsPassword: true,
      why: 'Confirmers are asked "are you OK?" if you go quiet. Your trusted person receives the handover. You need at least one of each before you can switch on, and one person can be both. Nobody counts until they accept.',
      how: [`Add two confirmers: people who would notice if you went quiet (${confirmers} of 2 accepted). With two, one mistaken "not OK" cannot start a handover on its own.`, `Add the person who should take over (${trusted.length ? 'done' : 'not yet'}). They can also be one of your confirmers.`, 'They each get an email to accept. Your trusted person chooses their own passphrase.'],
    },
    {
      id: 'messages', group: 'Your handover', title: 'Leave a personal message', optional: true, done: trusted.some(n => n.message), needsPassword: true,
      why: 'A private note, and files if you like, that only your trusted person can open, with the passphrase they chose.',
      how: ['Choose the person.', 'Write your message and attach any files.', 'Press "Seal". Nobody else can ever read it, including you.'],
    },
    {
      id: 'instructions', group: 'Your handover', title: 'Write your handover instructions', done: st.hasInstructions, needsPassword: true,
      why: 'What your trusted person needs to know: where things are, who to call, what must keep running.',
      how: ['Start from a template, or write your own.', 'Choose a passphrase and give it to your trusted person in advance, for example on paper in a safe place.', 'Press "Seal and save".'],
    },
    {
      id: 'switch', group: 'Switch on', title: 'Set your timers and switch on', done: st.settings.enabled && st.coverage.ok, needsPassword: true,
      why: 'Nothing happens until your switch is on. The defaults suit most people: first reminder after 14 days.',
      how: ['Make sure at least one confirmer and one trusted person have accepted.', 'Adjust the timers if you like.', 'Tick "My switch is on" and save.'],
    },
    {
      id: 'test', group: 'Switch on', title: 'Send yourself the test emails', done: st.events.some(e => e.type === 'TEST_EMAILS_SENT'),
      why: 'See exactly what you and your contacts would receive, and make sure our emails reach you and not your spam folder.',
      how: ['Press the button.', 'Check your inbox. Every email is marked [TEST] and goes only to you.'],
    },
  ]
  const more: Step[] = [
    { id: 'channels', group: 'More', title: 'Alert channels', needsPassword: true, why: 'Send your reminders and alerts to ntfy, Discord, Slack, Telegram or a webhook as well. For notifications on your phone, use "Check in from your phone".' },
    { id: 'terminal', group: 'More', title: 'Check in from the terminal', why: 'A personal token so you can check in with one command. Run it yourself when you mean it: never put it in a scheduled job, or it would keep saying you are OK when you are not.' },
    { id: 'activity', group: 'More', title: 'Activity', why: 'Everything that has happened on your account.' },
    { id: 'account', group: 'More', title: 'Account', why: 'Change your password or delete your account.' },
  ]
  return { setup, more }
}

function StepIcon({ state, n }: { state: 'done' | 'current' | 'todo' | 'optional'; n: number }) {
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold'
  if (state === 'done') return (
    <span className={`${base} bg-emerald-600 text-white`} aria-label="Done">
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 10.5l3.2 3L15 6.5" /></svg>
    </span>
  )
  if (state === 'current') return <span className={`${base} bg-brand text-white`}>{n}</span>
  return <span className={`${base} border border-black/15 text-black/50 dark:border-white/20 dark:text-white/50`}>{n}</span>
}

/** Renders a settings section flush inside the step panel (its own card frame and first heading are hidden). */
function Flush({ children }: { children: ReactNode }) {
  return <div className="[&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none [&>section>h2:first-child]:hidden">{children}</div>
}

/** Shown when the switch cannot actually do anything: nobody to ask, or nobody to hand over to. */
function NotCovered({ st }: { st: Status }) {
  return (
    <Notice tone="error">
      <span className="block font-medium">{st.settings.enabled ? 'Your switch is on, but it cannot hand over.' : 'You need people before you can switch on.'}</span>
      <span className="mt-1 block">You have {st.coverage.missing.join(', and ')}. One person can be both.</span>
    </Notice>
  )
}

function StatusPanel({ st, go }: { st: Status; go: (id: StepId) => void }) {
  const s = st.settings
  const stage = STAGE[s.stage] ?? STAGE.ACTIVE
  const urgent = s.stage !== 'ACTIVE'
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">Your switch</p>
        <Notice tone={s.enabled ? stage.tone : 'warn'}>{s.enabled ? (st.paused ? `Paused until ${fmt(s.pausedUntil)}` : stage.label) : 'Off: nothing will happen yet'}</Notice>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-black/55 dark:text-white/55">Last check-in</dt><dd className="text-right">{fmt(s.lastCheckinAt)}</dd></div>
          {s.enabled && s.stage === 'ACTIVE' && !st.paused && (
            <div className="flex justify-between gap-3"><dt className="text-black/55 dark:text-white/55">First reminder</dt><dd className="text-right">{fmt(st.schedule.reminder1At)}</dd></div>
          )}
          {s.stage === 'NOMINEES_ALERTED' && (
            <div className="flex justify-between gap-3"><dt className="text-black/55 dark:text-white/55">&ldquo;Not OK&rdquo; answers</dt><dd>{st.notOkCount}</dd></div>
          )}
          {s.stage === 'HOLD' && (
            <div className="flex justify-between gap-3"><dt className="text-black/55 dark:text-white/55">Handover sent</dt><dd className="text-right">{fmt(s.holdEndsAt)}</dd></div>
          )}
        </dl>
        <div className="mt-5 [&_button]:w-full"><CheckInButton urgent={urgent} /></div>
        {urgent && <Muted className="mt-3">Checking in cancels everything and tells anyone we contacted that you are OK.</Muted>}
      </div>
      {s.enabled && !st.coverage.ok && s.stage !== 'HANDOVER_SENT' && <NotCovered st={st} />}
      {s.enabled && !st.scheduler.healthy && (
        <Notice tone="error">Reminders may be delayed: the scheduler has not run recently. If you run this site, check the scheduler.</Notice>
      )}
      <div className="rounded-2xl border border-black/10 bg-white p-5 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">Good to know</p>
        <ul className="space-y-2">
          <li><Link href="/#how" className="text-brand hover:underline">How the switch works</Link></li>
          <li><Link href="/privacy" className="text-brand hover:underline">What we store, and what we can&apos;t read</Link></li>
          <li>Going away? Pause your switch for up to 90 days under &ldquo;Set your timers&rdquo;.</li>
          {st.push.devices.length === 0 && <li>Rather not get reminder emails? <button onClick={() => go('phone')} className="text-brand hover:underline">Get them on your phone</button>.</li>}
        </ul>
      </div>
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        <p className="px-5 pb-3 pt-5 text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">Watch the walkthrough</p>
        <WalkthroughVideo />
        <p className="px-5 py-3 text-xs text-black/55 dark:text-white/55">Two minutes. Use the full-screen button to make it bigger.</p>
      </div>
    </div>
  )
}

function Activity({ st }: { st: Status }) {
  if (!st.events.length) return <Muted>Nothing yet.</Muted>
  return (
    <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
      {st.events.slice(0, 50).map(e => (
        <li key={e.id} className="flex justify-between gap-4 py-2">
          <span>{eventLabel(e.type)}{e.detail ? <span className="text-black/60 dark:text-white/60">: {e.detail}</span> : null}</span>
          <span className="shrink-0 text-black/50 dark:text-white/50">{fmt(e.createdAt)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Workspace() {
  const [st, setSt] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const [current, setCurrent] = useState<StepId | null>(null)

  const load = useCallback(async () => {
    const r = await api<Status>('/api/me', 'GET')
    if (r.ok) setSt(r.data); else setErr(r.error ?? 'Could not load your dashboard.')
  }, [])
  useEffect(() => { load() }, [load])

  // Keep the page current when someone accepts an invitation elsewhere: refresh when you come back
  // to the tab, and every 15 seconds while an invitation is still waiting.
  const waiting = !!st?.nominees.some(n => n.status === 'PENDING')
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = waiting ? window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 15_000) : undefined
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); if (timer) window.clearInterval(timer) }
  }, [load, waiting])

  const steps = useMemo(() => (st ? buildSteps(st) : null), [st])

  // Pick the step from the address (?s=people), otherwise the first unfinished one.
  useEffect(() => {
    if (!steps || current) return
    const fromUrl = new URLSearchParams(window.location.search).get('s') as StepId | null
    const all = [...steps.setup, ...steps.more].map(s => s.id)
    setCurrent(fromUrl && all.includes(fromUrl) ? fromUrl : steps.setup.find(s => !s.done && !s.optional)?.id ?? 'overview')
  }, [steps, current])

  const go = (id: StepId) => {
    setCurrent(id)
    const u = new URL(window.location.href); u.searchParams.set('s', id); window.history.replaceState(null, '', u)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (err) return <Notice tone="error">{err}</Notice>
  if (!st || !steps || !current) return <Muted>Loading…</Muted>

  const required = steps.setup.filter(s => !s.optional)
  const doneCount = required.filter(s => s.done).length
  const allDone = doneCount === required.length
  const list = [...steps.setup, ...steps.more]
  const step = list.find(s => s.id === current)
  const setupIndex = steps.setup.findIndex(s => s.id === current)
  const next = steps.setup.slice(setupIndex + 1).find(s => !s.done)
  const groups = Array.from(new Set(steps.setup.map(s => s.group)))

  const body: Partial<Record<StepId, ReactNode>> = {
    email: st.user.verified ? <Notice tone="ok">Your email address is confirmed.</Notice> : <Notice tone="warn">Didn&apos;t get it? Check your spam folder, or <ResendVerification /></Notice>,
    login: <Security st={st} reload={load} />,
    phone: <PhoneReminders st={st} reload={load} go={go} />,
    people: <Contacts st={st} reload={load} />,
    messages: st.nominees.some(n => n.role === 'TRUSTED' && n.status === 'ACCEPTED')
      ? <PersonalMessages st={st} reload={load} />
      : <Notice tone="info">
          Personal messages go to the person who receives your handover, locked to their own passphrase.{' '}
          {st.nominees.some(n => n.role === 'TRUSTED' && n.status === 'PENDING')
            ? 'Your handover person has not accepted yet. This step opens as soon as they do.'
            : st.nominees.some(n => n.role === 'CONFIRMER' && n.status === 'ACCEPTED')
              ? 'Your confirmers cannot receive one. In “Choose your people”, press “Also receives handover” next to someone, or invite a new person as “Receives handover”.'
              : 'First add them in “Choose your people” and wait for them to accept.'}
          {' '}<button onClick={() => go('people')} className="font-medium underline">Choose your people</button>
        </Notice>,
    instructions: <Instructions st={st} reload={load} />,
    switch: <>{!st.coverage.ok && <div className="mb-5"><NotCovered st={st} /></div>}<Timers st={st} reload={load} /></>,
    test: <TestEmails />,
    channels: <AlertChannels st={st} reload={load} />,
    terminal: <CheckinTokens st={st} reload={load} />,
    activity: <Activity st={st} />,
    account: <Account />,
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
      {/* Left: progress and steps */}
      <nav className="order-3 space-y-4 lg:order-1" aria-label="Setup steps">
        <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{allDone ? 'Setup complete' : 'Your setup'}</span>
            <span className="text-black/55 dark:text-white/55">{doneCount} of {required.length}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${(doneCount / required.length) * 100}%` }} />
          </div>
          <button onClick={() => go('overview')} className={`mt-3 text-sm ${current === 'overview' ? 'font-semibold text-brand' : 'text-brand hover:underline'}`}>Overview</button>
        </div>
        {groups.map(g => (
          <div key={g} className="rounded-2xl border border-black/10 bg-white p-2 dark:border-white/10 dark:bg-white/5">
            <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">{g}</p>
            <ul>
              {steps.setup.filter(s => s.group === g).map(s => {
                const n = steps.setup.indexOf(s) + 1
                const state = s.done ? 'done' : s.id === current ? 'current' : 'todo'
                return (
                  <li key={s.id}>
                    <button onClick={() => go(s.id)} aria-current={s.id === current ? 'step' : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm ${s.id === current ? 'bg-brand/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                      <StepIcon state={state} n={n} />
                      <span>
                        <span className="block font-medium">{s.title}</span>
                        <span className="block text-xs text-black/50 dark:text-white/50">{s.done ? 'Done' : s.optional ? 'Optional' : 'Not done yet'}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="rounded-2xl border border-black/10 bg-white p-2 dark:border-white/10 dark:bg-white/5">
          <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">More</p>
          <ul>
            {steps.more.map(s => (
              <li key={s.id}>
                <button onClick={() => go(s.id)} className={`w-full rounded-xl px-3 py-2 text-left text-sm ${s.id === current ? 'bg-brand/10 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>{s.title}</button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Middle: the chosen step */}
      <section className="order-2 min-w-0 rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-white/5 lg:order-2" aria-live="polite">
        {current === 'overview' || !step ? (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Hello, {st.user.name}</h1>
              <Muted className="mt-1">{allDone ? 'Your switch is set up. Check in whenever you like; we will remind you when it is due.' : `${required.length - doneCount} step${required.length - doneCount === 1 ? '' : 's'} left to finish setting up.`}</Muted>
            </div>
            {!allDone && (
              <button onClick={() => go(steps.setup.find(s => !s.done && !s.optional)!.id)} className="w-full rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white hover:bg-brand-dark">
                Continue: {steps.setup.find(s => !s.done && !s.optional)!.title}
              </button>
            )}
            <div>
              <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
              <Activity st={{ ...st, events: st.events.slice(0, 8) }} />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {setupIndex >= 0 && <p className="text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">Step {setupIndex + 1} of {steps.setup.length}</p>}
                <h1 className="text-xl font-semibold tracking-tight">{step.title}</h1>
              </div>
              {setupIndex >= 0 && (
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${step.done ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60'}`}>
                  {step.done ? 'Done' : step.optional ? 'Optional' : 'Not done yet'}
                </span>
              )}
            </header>
            <p className="text-sm text-black/70 dark:text-white/70">{step.why}</p>
            {step.how && (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                {step.how.map(h => <li key={h}>{h}</li>)}
              </ol>
            )}
            {step.needsPassword && <ReauthBar until={st.confirmedUntil} reload={load} />}
            <Flush>{body[step.id]}</Flush>
            {setupIndex >= 0 && next && (
              <div className="border-t border-black/10 pt-4 text-right dark:border-white/10">
                <button onClick={() => go(next.id)} className="text-sm font-medium text-brand hover:underline">Next: {next.title} →</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Right: the switch */}
      <aside className="order-1 lg:order-3"><StatusPanel st={st} go={go} /></aside>
    </div>
  )
}
