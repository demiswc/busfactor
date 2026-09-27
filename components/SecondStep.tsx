'use client'
import { useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '@/lib/client'
import { Button, Field, Input, Muted, Notice } from './ui'

type Factor = 'passkey' | 'totp' | 'email' | 'recovery'
const LABEL: Record<Factor, string> = { passkey: 'Passkey or security key', totp: 'Authenticator app', email: 'Email me a code', recovery: 'Recovery code' }

export function SecondStep({ methods, onDone }: { methods: Factor[]; onDone: () => void }) {
  const [method, setMethod] = useState<Factor>(methods[0])
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setErr('')
    const r = await fn()
    setBusy(false)
    if (r.ok) onDone(); else setErr(r.error ?? 'That did not work.')
  }

  async function passkey() {
    setBusy(true); setErr('')
    const o = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/api/auth/2fa/passkey', 'POST', { options: true })
    if (!o.ok) { setBusy(false); return setErr(o.error ?? 'Could not start.') }
    try {
      const response = await startAuthentication({ optionsJSON: o.data.options })
      await run(() => api('/api/auth/2fa/passkey', 'POST', { response }))
    } catch { setBusy(false); setErr('The passkey was cancelled or not recognised.') }
  }

  async function sendEmail() {
    setBusy(true); setErr('')
    const r = await api('/api/auth/2fa/email', 'POST', { send: true })
    setBusy(false)
    r.ok ? setInfo('Code sent. Check your inbox (and spam).') : setErr(r.error ?? 'Could not send.')
  }

  return (
    <div className="space-y-4">
      <Muted>One more step to prove it&apos;s you.</Muted>
      {methods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {methods.map(m => (
            <button key={m} type="button" onClick={() => { setMethod(m); setCode(''); setErr(''); setInfo('') }}
              className={`rounded-full border px-3 py-1 text-xs ${method === m ? 'border-brand bg-brand/10 text-brand' : 'border-black/15 dark:border-white/15'}`}>{LABEL[m]}</button>
          ))}
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}
      {method === 'passkey' ? (
        <Button onClick={passkey} disabled={busy} className="w-full">{busy ? 'Waiting for your key…' : 'Use my passkey or security key'}</Button>
      ) : (
        <form className="space-y-3" onSubmit={e => {
          e.preventDefault()
          const path = method === 'totp' ? '/api/auth/2fa/totp' : method === 'email' ? '/api/auth/2fa/email' : '/api/auth/2fa/recovery'
          run(() => api(path, 'POST', { code }))
        }}>
          {method === 'email' && <Button type="button" variant="secondary" onClick={sendEmail} disabled={busy}>Send me a code</Button>}
          <Field label={method === 'recovery' ? 'Recovery code' : '6-digit code'}>
            <Input value={code} onChange={e => setCode(e.target.value)} autoFocus autoComplete="one-time-code" inputMode={method === 'recovery' ? 'text' : 'numeric'} />
          </Field>
          <Button disabled={busy || !code} className="w-full">Continue</Button>
        </form>
      )}
    </div>
  )
}
