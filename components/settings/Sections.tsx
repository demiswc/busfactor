'use client'
/** Settings sections added for security, personal messages, alert channels and CLI tokens. */
import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { api } from '@/lib/client'
import { b64, keyFingerprint, sealForRecipient, type MessagePayload } from '@/lib/sealed'
import { Button, Card, Field, H2, Input, Muted, Notice } from '@/components/ui'
import type { Status } from '@/app/settings/SettingsClient'

type Msg = { tone: 'ok' | 'error'; text: string } | null
const Flash = ({ msg }: { msg: Msg }) => (msg ? <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null)
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : 'never')
const MAX_BYTES = 10 * 1024 * 1024

// ------------------------------------------------------------------ personal messages

export function PersonalMessages({ st, reload }: { st: Status; reload: () => void }) {
  const trusted = st.nominees.filter(n => n.role === 'TRUSTED' && n.status === 'ACCEPTED')
  const [openId, setOpenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [fps, setFps] = useState<Record<string, string>>({})
  useEffect(() => {
    Promise.all(trusted.filter(n => n.publicKey).map(async n => [n.id, await keyFingerprint(n.publicKey!)] as const)).then(r => setFps(Object.fromEntries(r)))
  }, [st.nominees]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!trusted.length) return null

  const total = files.reduce((a, f) => a + f.size, 0) + new TextEncoder().encode(text).length

  async function save(nomineeId: string, publicKey: string) {
    if (!text.trim() && !files.length) return setMsg({ tone: 'error', text: 'Write something or attach a file.' })
    if (total > MAX_BYTES) return setMsg({ tone: 'error', text: 'Messages are limited to 10 MB including attachments.' })
    setBusy(true); setMsg(null)
    const payload: MessagePayload = { text: text.trim(), files: [] }
    for (const f of files) payload.files.push({ name: f.name, type: f.type, size: f.size, data: b64(new Uint8Array(await f.arrayBuffer())) })
    const box = await sealForRecipient(JSON.stringify(payload), publicKey)
    const r = await api('/api/me/messages', 'PUT', { nomineeId, box, sizeBytes: total })
    setBusy(false)
    if (r.ok) { setText(''); setFiles([]); setOpenId(null); setMsg({ tone: 'ok', text: 'Sealed and saved. Only they can open it now: not you, not this site.' }); reload() }
    else setMsg({ tone: 'error', text: r.error ?? 'Could not save.' })
  }
  async function remove(nomineeId: string) {
    if (!confirm('Delete this message?')) return
    const r = await api('/api/me/messages', 'POST', { nomineeId })
    setMsg(r.ok ? { tone: 'ok', text: 'Deleted.' } : { tone: 'error', text: r.error ?? 'Failed.' }); reload()
  }

  return (
    <Card>
      <H2>Personal messages</H2>
      <Muted className="mb-4">
        Leave each trusted person their own message and files: a personal note, credentials, a PDF of your handover document.
        It is locked to <strong>their</strong> passphrase in this browser, so only they can ever open it. You cannot read it back either,
        so to change it, write it again.
      </Muted>
      <ul className="space-y-3">
        {trusted.map(n => (
          <li key={n.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><strong>{n.name}</strong>{' '}
                {n.message ? <span className="text-emerald-700 dark:text-emerald-300">message saved ({Math.ceil(n.message.sizeBytes / 1024)} KB, {fmt(n.message.updatedAt)})</span>
                  : n.hasKey ? <span className="text-black/50 dark:text-white/50">no message yet</span>
                  : <span className="text-amber-700 dark:text-amber-300">waiting for them to set a passphrase</span>}
              </span>
              <span className="flex gap-3">
                {n.hasKey && <button className="text-brand hover:underline" onClick={() => { setOpenId(openId === n.id ? null : n.id); setMsg(null) }}>{n.message ? 'Replace' : 'Write'}</button>}
                {n.message && <button className="text-red-600 hover:underline" onClick={() => remove(n.id)}>Delete</button>}
              </span>
            </div>
            {fps[n.id] && <div className="mt-1 text-xs text-black/50 dark:text-white/50">Key fingerprint <span className="font-mono">{fps[n.id]}</span>. {n.name} saw the same code when they set up; compare by phone if in doubt.</div>}
            {openId === n.id && n.publicKey && (
              <div className="mt-3 space-y-3">
                <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-black/20" placeholder={`Dear ${n.name}, …`} />
                <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} className="block text-sm" />
                <Muted>{Math.ceil(total / 1024)} KB of 10 MB</Muted>
                <Button onClick={() => save(n.id, n.publicKey!)} disabled={busy}>{busy ? 'Sealing…' : `Seal for ${n.name}`}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Flash msg={msg} />
    </Card>
  )
}

// ------------------------------------------------------------------ alert channels

export function AlertChannels({ st, reload }: { st: Status; reload: () => void }) {
  const [rows, setRows] = useState<Array<{ label: string; url: string }>>([])
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function save(list: Array<{ label: string; url: string }>) {
    setBusy(true); setMsg(null)
    const r = await api('/api/me/channels', 'PUT', { channels: list })
    setBusy(false)
    if (r.ok) { setRows([]); setMsg({ tone: 'ok', text: 'Saved.' }); reload() } else setMsg({ tone: 'error', text: r.error ?? 'Could not save.' })
  }
  async function test() {
    setBusy(true)
    const r = await api<{ results: Array<{ label: string; ok: boolean; error?: string }> }>('/api/me/channels', 'POST')
    setBusy(false)
    if (!r.ok) return setMsg({ tone: 'error', text: r.error ?? 'Failed.' })
    const bad = r.data.results.filter(x => !x.ok)
    setMsg(bad.length ? { tone: 'error', text: bad.map(b => `${b.label}: ${b.error}`).join('; ') } : { tone: 'ok', text: 'Test alert delivered to every channel.' })
  }

  return (
    <Card>
      <H2>Alert channels</H2>
      <Muted className="mb-4">
        Email can land in spam. Add up to 3 extra places for your own reminders and alerts: an <strong>ntfy</strong> topic
        (e.g. https://ntfy.sh/your-secret-topic), a <strong>Discord</strong> or <strong>Slack</strong> webhook, a <strong>Telegram</strong> bot
        URL (https://api.telegram.org/bot…/sendMessage?chat_id=…), or any <strong>webhook</strong> for automation, such as putting a site into maintenance mode when the handover is sent.
      </Muted>
      {st.channels.length > 0 && (
        <div className="mb-4">
          <ul className="space-y-2 text-sm">
            {st.channels.map(c => (
              <li key={c.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <strong>{c.label}</strong> <span className="text-black/50 dark:text-white/50">{c.kind} · {c.host}</span>
              </li>
            ))}
          </ul>
          <button className="mt-2 text-sm text-red-600 hover:underline" disabled={busy} onClick={() => confirm('Remove all alert channels?') && save([])}>Remove all channels</button>
        </div>
      )}
      <Muted className="mb-3">Saving replaces the whole list (saved addresses are encrypted and never shown again, so enter them all).</Muted>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <Input placeholder="Label" value={r.label} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input placeholder="https://…" value={r.url} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <Button variant="ghost" type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {rows.length < 3 && <Button variant="secondary" type="button" onClick={() => setRows([...rows, { label: '', url: '' }])}>+ Add a channel</Button>}
        {rows.length > 0 && <Button onClick={() => save(rows.filter(r => r.url.trim()))} disabled={busy}>Save channels</Button>}
        {st.channels.length > 0 && <Button variant="secondary" onClick={test} disabled={busy}>Send a test alert</Button>}
      </div>
      {st.channelSecret && (
        <details className="mt-4 text-xs text-black/60 dark:text-white/60">
          <summary className="cursor-pointer">Verifying webhook signatures</summary>
          <p className="mt-2">Plain webhooks receive JSON with headers <code>X-Busfactor-Timestamp</code> and <code>X-Busfactor-Signature: sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code>.</p>
          <p className="mt-1">Your secret: <code className="break-all">{st.channelSecret}</code></p>
        </details>
      )}
      <Flash msg={msg} />
    </Card>
  )
}

// ------------------------------------------------------------------ security (2FA)

export function Security({ st, reload }: { st: Status; reload: () => void }) {
  const sec = st.security
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [totp, setTotp] = useState<{ setupId: string; secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [keyName, setKeyName] = useState('')

  async function call<T = Record<string, unknown>>(payload: Record<string, unknown>) {
    setBusy(true); setMsg(null)
    const r = await api<T & { recoveryCodes?: string[] | null }>('/api/me/security', 'POST', { password: pw, ...payload })
    setBusy(false)
    if (!r.ok) { setMsg({ tone: 'error', text: r.error ?? 'Failed.' }); return null }
    if (r.data.recoveryCodes) setCodes(r.data.recoveryCodes)
    return r.data
  }

  async function addPasskey() {
    const o = await call<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>({ action: 'passkey-options' })
    if (!o) return
    try {
      const response = await startRegistration({ optionsJSON: o.options })
      if (await call({ action: 'passkey-verify', response, name: keyName || 'Passkey' })) { setMsg({ tone: 'ok', text: 'Passkey added.' }); setKeyName(''); reload() }
    } catch { setMsg({ tone: 'error', text: 'The passkey was cancelled or not supported on this device.' }) }
  }

  return (
    <Card>
      <H2>Login security</H2>
      <Muted className="mb-4">Add a second step to logging in. Passkeys and security keys (YubiKey, Face ID, Windows Hello) are the strongest. Changes below need your password.</Muted>
      <div className="mb-5 max-w-xs"><Field label="Your password (to confirm changes)"><Input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></Field></div>

      {codes && (
        <div className="mb-5"><Notice tone="warn">
          <strong>Save these recovery codes now.</strong> Each works once if you lose your key or phone. They will not be shown again.
          <pre className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">{codes.join('\n')}</pre>
        </Notice></div>
      )}

      <div className="space-y-6 text-sm">
        <section>
          <h3 className="mb-2 font-semibold">Passkeys and security keys</h3>
          {sec.passkeys.length > 0 && (
            <ul className="mb-3 space-y-1">
              {sec.passkeys.map(k => (
                <li key={k.id} className="flex justify-between gap-3">
                  <span>🔑 {k.name} <span className="text-black/50 dark:text-white/50">added {fmt(k.createdAt)}, last used {fmt(k.lastUsedAt)}</span></span>
                  <button className="text-red-600 hover:underline" onClick={async () => { if (await call({ action: 'passkey-remove', id: k.id })) reload() }}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Name, e.g. YubiKey 5 (desk)" value={keyName} onChange={e => setKeyName(e.target.value)} className="max-w-xs" />
            <Button variant="secondary" onClick={addPasskey} disabled={busy || !pw}>Add a passkey</Button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Authenticator app {sec.totp && <span className="text-emerald-700 dark:text-emerald-300">(on)</span>}</h3>
          {sec.totp ? (
            <Button variant="secondary" disabled={busy || !pw} onClick={async () => { if (await call({ action: 'totp-disable' })) { setMsg({ tone: 'ok', text: 'Authenticator app removed.' }); reload() } }}>Turn off</Button>
          ) : totp ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={totp.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded bg-white p-2" />
              <Muted>Scan it, or enter this key: <code className="break-all">{totp.secret}</code></Muted>
              <div className="flex gap-2">
                <Input placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value)} className="max-w-[160px]" inputMode="numeric" />
                <Button disabled={busy} onClick={async () => { if (await call({ action: 'totp-confirm', setupId: totp.setupId, code })) { setTotp(null); setCode(''); setMsg({ tone: 'ok', text: 'Authenticator app is on.' }); reload() } }}>Confirm</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" disabled={busy || !pw} onClick={async () => { const r = await call<{ setupId: string; secret: string; qr: string }>({ action: 'totp-begin' }); if (r) setTotp(r) }}>Set up</Button>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Email codes {sec.emailOtp && <span className="text-emerald-700 dark:text-emerald-300">(on)</span>}</h3>
          <Muted className="mb-2">A 6-digit code emailed at login. Easy, but only as safe as your email account.</Muted>
          <Button variant="secondary" disabled={busy || !pw} onClick={async () => { if (await call({ action: 'email-otp', on: !sec.emailOtp })) reload() }}>
            {sec.emailOtp ? 'Turn off' : 'Turn on'}
          </Button>
        </section>

        {(sec.passkeys.length > 0 || sec.totp) && (
          <section>
            <h3 className="mb-2 font-semibold">Recovery codes</h3>
            <Muted className="mb-2">{sec.recoveryCodesLeft} unused.</Muted>
            <Button variant="secondary" disabled={busy || !pw} onClick={() => call({ action: 'recovery' })}>Make new codes</Button>
          </section>
        )}
      </div>
      <Flash msg={msg} />
    </Card>
  )
}

// ------------------------------------------------------------------ CLI tokens

export function CheckinTokens({ st, reload }: { st: Status; reload: () => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <Card>
      <H2>Check in from the terminal</H2>
      <Muted className="mb-4">
        Create a token and check in with one command. <strong>Run it yourself, never from cron or CI</strong>: a machine keeps checking in after you are gone, which defeats the point.
      </Muted>
      {st.apiTokens.length > 0 && (
        <ul className="mb-4 space-y-1 text-sm">
          {st.apiTokens.map(t => (
            <li key={t.id} className="flex justify-between gap-3">
              <span>{t.name} <span className="text-black/50 dark:text-white/50">created {fmt(t.createdAt)}, last used {fmt(t.lastUsedAt)}</span></span>
              <button className="text-red-600 hover:underline" onClick={async () => { const r = await api('/api/me/tokens', 'POST', { revoke: t.id }); if (r.ok) reload() }}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      {token ? (
        <Notice tone="warn">
          <strong>Copy this now; it will not be shown again.</strong>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">{`curl -X POST -H "Authorization: Bearer ${token}" ${origin}/api/v1/checkin`}</pre>
        </Notice>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Laptop terminal" /></Field>
          <Field label="Password"><Input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></Field>
          <Button variant="secondary" onClick={async () => {
            const r = await api<{ token: string }>('/api/me/tokens', 'POST', { name, password: pw })
            if (r.ok) { setToken(r.data.token); setPw(''); reload() } else setMsg({ tone: 'error', text: r.error ?? 'Failed.' })
          }}>Create token</Button>
        </div>
      )}
      <Flash msg={msg} />
    </Card>
  )
}
