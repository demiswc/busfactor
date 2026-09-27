'use client'
import { useState } from 'react'
import { api } from '@/lib/client'
import { createRecipientKeys, keyFingerprint, openForRecipient, openSealed, unb64, type MessagePayload } from '@/lib/sealed'
import { Button, Field, Input, Muted, Notice } from './ui'

const token = () => new URLSearchParams(window.location.search).get('t') ?? ''
type Msg = { tone: 'ok' | 'error'; text: string } | null

export function InviteButtons({ ownerName, role, needsKey, alreadyAccepted }: { ownerName: string; role: string; needsKey: boolean; alreadyAccepted: boolean }) {
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [hint, setHint] = useState('')
  const [showKey, setShowKey] = useState(alreadyAccepted && needsKey)
  const [fp, setFp] = useState('')

  async function answer(accept: boolean, keys?: object) {
    setBusy(true)
    const r = await api<{ message: string }>('/api/n/invite', 'POST', { t: token(), accept, ...keys })
    setBusy(false)
    setMsg({ tone: r.ok ? 'ok' : 'error', text: r.data.message || r.error || 'Something went wrong.' })
  }

  async function acceptWithKey(e: React.FormEvent) {
    e.preventDefault()
    if (pass.length < 10) return setMsg({ tone: 'error', text: 'Please use at least 10 characters. A few random words is ideal.' })
    if (pass !== pass2) return setMsg({ tone: 'error', text: 'The two passphrases do not match.' })
    setBusy(true); setMsg(null)
    const keys = await createRecipientKeys(pass)
    setFp(await keyFingerprint(keys.publicKey))
    await answer(true, { ...keys, hint })
  }

  if (msg?.tone === 'ok') return (
    <div className="space-y-3">
      <Notice tone="ok">{msg.text}</Notice>
      {fp && <Notice tone="info">Your key fingerprint is <strong className="font-mono">{fp}</strong>. {ownerName} sees the same code in their settings: if they ever ask, read it to them so you can both be sure the key is yours.</Notice>}
    </div>
  )
  if (role === 'TRUSTED' && showKey) return (
    <form onSubmit={acceptWithKey} className="space-y-4">
      <Notice tone="info">
        Choose a passphrase only you know. {ownerName} can then leave you a personal message that <strong>only you</strong> can open,
        not even this website. Write it down somewhere safe: you may not need it for years, and it cannot be recovered.
      </Notice>
      {msg && <Notice tone="error">{msg.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your passphrase"><Input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Passphrase again"><Input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <Field label="Hint for yourself (optional)" hint="Never the passphrase itself.">
        <Input maxLength={200} value={hint} onChange={e => setHint(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy}>{busy ? 'Setting up… (a few seconds)' : alreadyAccepted ? 'Save my passphrase' : `Accept and save my passphrase`}</Button>
        {!alreadyAccepted && <Button type="button" variant="secondary" onClick={() => answer(false)} disabled={busy}>No thanks</Button>}
      </div>
    </form>
  )
  return (
    <div className="space-y-3">
      {msg && <Notice tone="error">{msg.text}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => (role === 'TRUSTED' ? setShowKey(true) : answer(true))} disabled={busy}>Yes, I&apos;ll help {ownerName}</Button>
        <Button variant="secondary" onClick={() => answer(false)} disabled={busy}>No thanks</Button>
      </div>
    </div>
  )
}

export function RespondButtons({ ownerName }: { ownerName: string }) {
  const [confirmNotOk, setConfirmNotOk] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  async function answer(a: 'OK' | 'NOT_OK') {
    setBusy(true)
    const r = await api<{ message: string }>('/api/n/respond', 'POST', { t: token(), answer: a })
    setBusy(false)
    setMsg({ tone: r.ok ? 'ok' : 'error', text: r.data.message || r.error || 'Something went wrong.' })
  }
  if (msg) return <Notice tone={msg.tone}>{msg.text}</Notice>
  if (confirmNotOk) return (
    <div className="space-y-4">
      <Notice tone="warn">Are you sure? Only choose this if you have tried to reach {ownerName} and believe they cannot look after things right now.</Notice>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={() => answer('NOT_OK')} disabled={busy}>Yes, {ownerName} is not OK</Button>
        <Button variant="secondary" onClick={() => setConfirmNotOk(false)} disabled={busy}>Go back</Button>
      </div>
    </div>
  )
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => answer('OK')} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">{ownerName} is OK</Button>
      <Button variant="danger" onClick={() => setConfirmNotOk(true)} disabled={busy}>{ownerName} is not OK</Button>
    </div>
  )
}

type General = { mode: 'SERVER'; text: string } | { mode: 'SEALED'; sealed: string; hint: string | null } | { mode: 'NONE' }
type Opened = { ok: boolean; general?: General; personal?: { box: string; encPrivateKey: string; hint: string | null } | null; message?: string }

function Words({ text, owner }: { text: string; owner: string }) {
  return (
    <div className="space-y-3">
      <pre className="whitespace-pre-wrap rounded-xl border border-black/10 bg-white p-5 font-sans text-base leading-relaxed dark:border-white/10 dark:bg-black/30">{text}</pre>
      <Muted>These are {owner}&apos;s own words. Please keep them private.</Muted>
    </div>
  )
}

function download(f: MessagePayload['files'][number]) {
  const blob = new Blob([unb64(f.data) as unknown as BlobPart], { type: f.type || 'application/octet-stream' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = f.name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

function PersonalMessage({ owner, p }: { owner: string; p: NonNullable<Opened['personal']> }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [payload, setPayload] = useState<MessagePayload | null>(null)
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { setPayload(JSON.parse(await openForRecipient(p.box, p.encPrivateKey, pass))) } catch { setErr('That passphrase did not work. It is the one you chose when you accepted the invitation.') }
    setBusy(false)
  }
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">A personal message for you</h2>
      {payload ? (
        <>
          {payload.text && <Words text={payload.text} owner={owner} />}
          {payload.files.length > 0 && (
            <ul className="space-y-2">
              {payload.files.map((f, i) => (
                <li key={i}><Button variant="secondary" onClick={() => download(f)}>Download {f.name} ({Math.ceil(f.size / 1024)} KB)</Button></li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form onSubmit={unlock} className="space-y-3">
          <Muted>Only you can open this, with the passphrase <strong>you</strong> chose when you accepted {owner}&apos;s invitation.</Muted>
          {p.hint && <Notice tone="info">Your hint: {p.hint}</Notice>}
          <Field label="Your passphrase"><Input type="password" value={pass} onChange={e => setPass(e.target.value)} /></Field>
          {err && <Notice tone="error">{err}</Notice>}
          <Button disabled={busy || !pass}>{busy ? 'Unlocking… (a few seconds)' : 'Unlock my message'}</Button>
        </form>
      )}
    </section>
  )
}

function GeneralInstructions({ owner, g }: { owner: string; g: General }) {
  const [pass, setPass] = useState('')
  const [text, setText] = useState(g.mode === 'SERVER' ? g.text : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (g.mode === 'NONE') return null
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { setText(await openSealed((g as { sealed: string }).sealed, pass)) } catch { setErr('That passphrase did not work. Check spaces and capital letters, and try again.') }
    setBusy(false)
  }
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Instructions</h2>
      {text ? <Words text={text} owner={owner} /> : (
        <form onSubmit={unlock} className="space-y-3">
          <Muted>{owner} locked these with a passphrase they should have given you in advance.</Muted>
          {g.mode === 'SEALED' && g.hint && <Notice tone="info">Hint from {owner}: {g.hint}</Notice>}
          <Field label="Passphrase"><Input type="password" value={pass} onChange={e => setPass(e.target.value)} /></Field>
          {err && <Notice tone="error">{err}</Notice>}
          <Button disabled={busy || !pass}>{busy ? 'Unlocking… (a few seconds)' : 'Unlock'}</Button>
          <Muted>The passphrase never leaves this device. Unlocking happens entirely in your browser.</Muted>
        </form>
      )}
    </section>
  )
}

export function HandoverViewer({ ownerName }: { ownerName: string }) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true); setErr('')
    const r = await api<Opened>('/api/n/handover', 'POST', { t: token() })
    setBusy(false)
    if (!r.ok) return setErr(r.data.message || r.error || 'Could not open.')
    setOpened(r.data)
  }

  if (opened) {
    const nothing = opened.general?.mode === 'NONE' && !opened.personal
    return (
      <div className="space-y-8">
        {opened.personal && <PersonalMessage owner={ownerName} p={opened.personal} />}
        {opened.general && <GeneralInstructions owner={ownerName} g={opened.general} />}
        {nothing && <Notice tone="warn">{ownerName} did not leave written instructions. Please speak to their family or the other people who were contacted.</Notice>}
        <Button variant="secondary" onClick={() => window.print()}>Print this page</Button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Button onClick={open} disabled={busy}>{busy ? 'Opening…' : 'Open the instructions'}</Button>
    </div>
  )
}
