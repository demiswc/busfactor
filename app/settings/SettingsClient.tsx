'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/client'
import { sealText } from '@/lib/sealed'
import { Button, Card, Field, H2, Input, Muted, Notice } from '@/components/ui'
import { AlertChannels, CheckinTokens, PersonalMessages, Security } from '@/components/settings/Sections'
import { TEMPLATES } from '@/lib/templates'

export interface Nominee { id: string; name: string; email: string; role: 'CONFIRMER' | 'TRUSTED'; status: string; hasKey: boolean; publicKey: string | null; message: { sizeBytes: number; updatedAt: string } | null }
export interface Status {
  user: { name: string; email: string; verified: boolean }
  settings: {
    enabled: boolean; stage: string; pausedUntil: string | null; lastCheckinAt: string | null; holdEndsAt: string | null
    reminder1AfterDays: number; reminder2AfterDays: number; nomineeAlertAfterDays: number
    requiredConfirmations: number; nomineeReminderHours: number; nomineeFinalHours: number; holdHours: number
    instructionsMode: 'NONE' | 'SERVER' | 'SEALED'; sealedHint: string | null
  }
  hasInstructions: boolean
  serverInstructionsAllowed: boolean
  channels: Array<{ id: string; label: string; kind: string; host: string }>
  channelSecret: string | null
  security: { totp: boolean; emailOtp: boolean; passkeys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>; recoveryCodesLeft: number }
  apiTokens: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>
  nominees: Nominee[]
  confirmedUntil: string | null
  // also returned by /api/me, used by the dashboard
  paused: boolean
  daysSinceCheckin: number
  notOkCount: number
  scheduler: { lastTickAt: string | null; healthy: boolean }
  schedule: { reminder1At: string; reminder2At: string; nomineeAlertAt: string; nomineeReminderAt: string | null; goAheadAt: string | null }
  events: Array<{ id: string; type: string; detail: string | null; createdAt: string }>
}
type Msg = { tone: 'ok' | 'error'; text: string } | null

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function Flash({ msg }: { msg: Msg }) {
  return msg ? <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null
}

export default function SettingsClient() {
  const [st, setSt] = useState<Status | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const load = useCallback(async () => {
    const r = await api<Status>('/api/me', 'GET')
    if (r.ok) setSt(r.data); else setLoadErr(r.error ?? 'Could not load settings.')
  }, [])
  useEffect(() => { load() }, [load])

  if (loadErr) return <Notice tone="error">{loadErr}</Notice>
  if (!st) return <Muted>Loading…</Muted>
  const locked = !['ACTIVE', 'REMINDER_1', 'REMINDER_2'].includes(st.settings.stage)

  return (
    <div className="space-y-6">
      {!st.user.verified && <Notice tone="warn">Confirm your email address first. Until then you can look around but not switch on or invite anyone.</Notice>}
      {locked && <Notice tone="error">Your contacts have been alerted. Check in on the dashboard before changing contacts.</Notice>}
      <ReauthBar until={st.confirmedUntil} reload={load} />
      <Contacts st={st} reload={load} />
      <PersonalMessages st={st} reload={load} />
      <Instructions st={st} reload={load} />
      <Timers st={st} reload={load} />
      <AlertChannels st={st} reload={load} />
      <TestEmails />
      <Security st={st} reload={load} />
      <CheckinTokens st={st} reload={load} />
      <Account />
    </div>
  )
}

// ---------------------------------------------------------------- password confirmation

export function ReauthBar({ until, reload }: { until: string | null; reload: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const open = until && new Date(until).getTime() > now
  if (open) return <Notice tone="ok">Changes unlocked on this device until {new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</Notice>
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <form className="flex flex-wrap items-end gap-3" onSubmit={async e => {
        e.preventDefault(); setErr('')
        const r = await api('/api/me/reauth', 'POST', { password: pw })
        if (r.ok) { setPw(''); reload() } else setErr(r.error ?? 'Could not confirm.')
      }}>
        <div className="min-w-[240px] flex-1">
          <Field label="Confirm your password to make changes" hint="Protects your switch if someone gets hold of your logged-in browser. Lasts 15 minutes.">
            <Input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
        <Button disabled={!pw}>Unlock changes</Button>
      </form>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
    </Card>
  )
}

// ---------------------------------------------------------------- contacts

export function Contacts({ st, reload }: { st: Status; reload: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'CONFIRMER' })
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const r = await api('/api/me/nominees', 'POST', f)
    setBusy(false)
    if (r.ok) { setMsg({ tone: 'ok', text: `Invitation sent to ${f.email}.` }); setF({ name: '', email: '', role: f.role }); reload() }
    else setMsg({ tone: 'error', text: r.error ?? 'Could not add.' })
  }
  async function act(path: string, id: string, ok: string) {
    const r = await api(path, 'POST', { id })
    setMsg(r.ok ? { tone: 'ok', text: ok } : { tone: 'error', text: r.error ?? 'Failed.' })
    reload()
  }
  const badge = (s: string) => s === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    : s === 'DECLINED' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'

  return (
    <Card>
      <H2>Your people</H2>
      <Muted className="mb-4">
        <strong>Confirmers</strong> are asked “is {st.user.name} OK?” if you stop checking in. Two is ideal: partner, sibling, close friend.
        Your <strong>trusted person</strong> receives the handover link. Everyone must accept an invitation before they count.
      </Muted>
      {st.nominees.length > 0 && (
        <ul className="mb-5 divide-y divide-black/5 dark:divide-white/10">
          {st.nominees.map(n => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <div className="font-medium">{n.name} <span className="font-normal text-black/50 dark:text-white/50">{n.email}</span></div>
                <div className="mt-1 flex gap-2">
                  <span className="rounded bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{n.role === 'TRUSTED' ? 'Receives handover' : 'Confirmer'}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${badge(n.status)}`}>{n.status.toLowerCase()}</span>
                  {n.role === 'TRUSTED' && n.status === 'ACCEPTED' && <span className="rounded bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{n.hasKey ? '🔑 passphrase set' : 'no passphrase yet'}</span>}
                </div>
              </div>
              <div className="flex gap-3">
                {n.status !== 'ACCEPTED' && <button className="text-brand hover:underline" onClick={() => act('/api/me/nominees/resend', n.id, 'Invitation sent again.')}>Resend</button>}
                {n.status === 'ACCEPTED' && n.role === 'TRUSTED' && !n.hasKey && <button className="text-brand hover:underline" onClick={() => act('/api/me/nominees/resend', n.id, 'Asked them to set up their passphrase.')}>Ask to set a passphrase</button>}
                <button className="text-red-600 hover:underline" onClick={() => confirm(`Remove ${n.name}?`) && act('/api/me/nominees/remove', n.id, 'Removed.')}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label="Name"><Input required maxLength={100} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><Input required type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role">
          <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })} className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-black/20">
            <option value="CONFIRMER">Confirmer</option>
            <option value="TRUSTED">Receives handover</option>
          </select>
        </Field>
        <Button disabled={busy || !st.user.verified}>Invite</Button>
      </form>
      <Flash msg={msg} />
    </Card>
  )
}

// ---------------------------------------------------------------- instructions

export function Instructions({ st, reload }: { st: Status; reload: () => void }) {
  const [mode, setMode] = useState<'SEALED' | 'SERVER' | 'NONE'>(st.settings.instructionsMode === 'NONE' ? 'SEALED' : st.settings.instructionsMode)
  const [text, setText] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [hint, setHint] = useState(st.settings.sealedHint ?? '')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    if (mode !== 'NONE' && !text.trim()) return setMsg({ tone: 'error', text: 'Please write your instructions.' })
    let payload: Record<string, string> = { mode }
    if (mode === 'SEALED') {
      if (pass.length < 8) return setMsg({ tone: 'error', text: 'Use a passphrase of at least 8 characters, ideally a few words.' })
      if (pass !== pass2) return setMsg({ tone: 'error', text: 'The two passphrases do not match.' })
      setBusy(true)
      payload = { mode, sealed: await sealText(text.trim(), pass), hint }
    } else if (mode === 'SERVER') payload = { mode, text: text.trim() }
    setBusy(true)
    const r = await api('/api/me/instructions', 'PUT', payload)
    setBusy(false)
    if (r.ok) { setText(''); setPass(''); setPass2(''); setMsg({ tone: 'ok', text: mode === 'NONE' ? 'Instructions removed.' : 'Saved. For your privacy they are not shown again. Write new ones here to replace them.' }); reload() }
    else setMsg({ tone: 'error', text: r.error ?? 'Could not save.' })
  }

  const opt = (m: typeof mode, title: string, desc: string, disabled = false) => (
    <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${mode === m ? 'border-brand bg-brand/5' : 'border-black/10 dark:border-white/10'} ${disabled ? 'opacity-50' : ''}`}>
      <input type="radio" name="mode" checked={mode === m} disabled={disabled} onChange={() => setMode(m)} className="mt-1" />
      <span><strong>{title}</strong><br /><span className="text-black/60 dark:text-white/60">{desc}</span></span>
    </label>
  )

  return (
    <Card>
      <H2>Handover instructions</H2>
      <Muted className="mb-4">
        What should your trusted person know? Where things are, who to call, what to keep running, what can be switched off.
        {st.hasInstructions && <> <strong>You have saved instructions ({st.settings.instructionsMode === 'SEALED' ? 'sealed' : 'server-encrypted'}).</strong></>}
      </Muted>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-2">
          {opt('SEALED', 'Sealed with a passphrase (recommended)', 'Encrypted in this browser. We cannot read it. Give the passphrase to your trusted person in advance, e.g. on paper in a safe place.')}
          {opt('SERVER', 'Encrypted by this site', 'Simpler, since no passphrase is needed, but the site operator could technically read it.', !st.serverInstructionsAllowed)}
          {opt('NONE', 'No written instructions', 'Your trusted person is simply told to contact your confirmers.')}
        </div>
        {mode !== 'NONE' && (
          <>
          {!text && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-black/60 dark:text-white/60">Start from a template:</span>
              {TEMPLATES.map(t => (
                <button key={t.id} type="button" onClick={() => setText(t.text)}
                  className="rounded-full border border-black/15 px-3 py-1 font-medium text-brand hover:bg-brand/5 dark:border-white/15">{t.label}</button>
              ))}
            </div>
          )}
          <Field label="Instructions">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={8} maxLength={20000}
              className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-black/20"
              placeholder={'e.g.\nThe handover document is on the USB drive in the desk drawer.\nPasswords: 1Password, emergency kit is in the fire safe.\nCall Sam at the hosting company: 07…\nClients to notify: …'} />
          </Field>
          </>
        )}
        {mode === 'SEALED' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Passphrase"><Input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Passphrase again"><Input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" /></Field>
            <div className="sm:col-span-2">
              <Field label="Hint (optional, shown to your trusted person)" hint="Never the passphrase itself, e.g. “the words on the card in the safe”.">
                <Input maxLength={200} value={hint} onChange={e => setHint(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
        <Button disabled={busy}>{busy ? 'Saving…' : mode === 'SEALED' ? 'Seal and save' : 'Save'}</Button>
      </form>
      <Flash msg={msg} />
    </Card>
  )
}

// ---------------------------------------------------------------- timers

export function Timers({ st, reload }: { st: Status; reload: () => void }) {
  const s = st.settings
  const [f, setF] = useState({
    enabled: s.enabled, reminder1AfterDays: s.reminder1AfterDays, reminder2AfterDays: s.reminder2AfterDays, nomineeAlertAfterDays: s.nomineeAlertAfterDays,
    requiredConfirmations: s.requiredConfirmations, nomineeReminderHours: s.nomineeReminderHours, nomineeFinalHours: s.nomineeFinalHours,
    holdHours: s.holdHours, pausedUntil: toLocalInput(s.pausedUntil),
  })
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) })

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const r = await api('/api/me', 'PUT', { ...f, pausedUntil: f.pausedUntil ? new Date(f.pausedUntil).toISOString() : null })
    setBusy(false)
    if (r.ok) { setMsg({ tone: 'ok', text: 'Saved.' }); reload() } else setMsg({ tone: 'error', text: r.error ?? 'Could not save.' })
  }

  return (
    <Card>
      <H2>Switch and timers</H2>
      <form onSubmit={save} className="space-y-5">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand)]" checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} />
          My switch is on
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="First reminder after (days)"><Input type="number" min={1} value={f.reminder1AfterDays} onChange={num('reminder1AfterDays')} /></Field>
          <Field label="Second reminder after (days)"><Input type="number" min={2} value={f.reminder2AfterDays} onChange={num('reminder2AfterDays')} /></Field>
          <Field label="Ask contacts after (days)"><Input type="number" min={3} value={f.nomineeAlertAfterDays} onChange={num('nomineeAlertAfterDays')} /></Field>
          <Field label="Remind silent contacts after (hours)"><Input type="number" min={1} value={f.nomineeReminderHours} onChange={num('nomineeReminderHours')} /></Field>
          <Field label="Then go ahead after (hours)"><Input type="number" min={1} value={f.nomineeFinalHours} onChange={num('nomineeFinalHours')} /></Field>
          <Field label="Safety wait before handover (hours)"><Input type="number" min={0} value={f.holdHours} onChange={num('holdHours')} /></Field>
          <Field label="“Not OK” answers that confirm it" hint="Capped at your number of confirmers."><Input type="number" min={1} max={5} value={f.requiredConfirmations} onChange={num('requiredConfirmations')} /></Field>
          <div className="sm:col-span-2">
            <Field label="Pause until (holiday, hospital stay)" hint="Up to 90 days. Leave empty for no pause.">
              <Input type="datetime-local" value={f.pausedUntil} onChange={e => setF({ ...f, pausedUntil: e.target.value })} />
            </Field>
          </div>
        </div>
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>
      <Flash msg={msg} />
    </Card>
  )
}

// ---------------------------------------------------------------- test emails & account

export function TestEmails() {
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const r = await api<{ sent: number; total: number; to: string; error?: string }>('/api/me/test-emails')
    setBusy(false)
    setMsg(r.ok && r.data.sent === r.data.total ? { tone: 'ok', text: `Sent ${r.data.sent} sample emails to ${r.data.to}.` }
      : { tone: 'error', text: r.error ?? `Only ${r.data.sent}/${r.data.total} sent: ${r.data.error ?? 'unknown error'}` })
  }
  return (
    <Card>
      <H2>Test emails</H2>
      <Muted className="mb-4">Sends a sample of every email to you only, marked [TEST], so you can see exactly what your contacts would receive. Nobody else is contacted.</Muted>
      <Button variant="secondary" onClick={go} disabled={busy}>{busy ? 'Sending…' : 'Send me the test emails'}</Button>
      <Flash msg={msg} />
    </Card>
  )
}

export function Account() {
  const [pw, setPw] = useState({ current: '', next: '' })
  const [del, setDel] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  return (
    <Card>
      <H2>Account</H2>
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={async e => {
        e.preventDefault()
        const r = await api('/api/me/password', 'POST', pw)
        setMsg(r.ok ? { tone: 'ok', text: 'Password changed. Other devices were signed out.' } : { tone: 'error', text: r.error ?? 'Failed.' })
        if (r.ok) setPw({ current: '', next: '' })
      }}>
        <Field label="Current password"><Input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password"><Input type="password" minLength={10} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
        <Button variant="secondary">Change password</Button>
      </form>
      <div className="mt-8 border-t border-black/10 pt-5 dark:border-white/10">
        <h3 className="mb-2 text-sm font-semibold text-red-600">Delete account</h3>
        <Muted className="mb-3">Deletes your account, contacts, instructions and history permanently. Your contacts are not notified.</Muted>
        <form className="flex flex-wrap gap-3" onSubmit={async e => {
          e.preventDefault()
          if (!confirm('Delete your account permanently?')) return
          const r = await api('/api/me/delete', 'POST', { password: del })
          if (r.ok) window.location.href = '/'
          else setMsg({ tone: 'error', text: r.error ?? 'Failed.' })
        }}>
          <Input type="password" placeholder="Your password" value={del} onChange={e => setDel(e.target.value)} className="max-w-xs" />
          <Button variant="danger">Delete my account</Button>
        </form>
      </div>
      <Flash msg={msg} />
    </Card>
  )
}
