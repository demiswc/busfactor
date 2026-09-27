'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, Field, H1, Input, Muted, Notice } from '@/components/ui'
import { SecondStep } from '@/components/SecondStep'

type Factor = 'passkey' | 'totp' | 'email' | 'recovery'

export default function LoginPage() {
  const [f, setF] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [methods, setMethods] = useState<Factor[] | null>(null)
  const [notice, setNotice] = useState('')

  // Only ever redirect within this site (blocks //evil.com and /\\evil.com tricks).
  const go = () => {
    const next = new URLSearchParams(window.location.search).get('next') || '/dashboard'
    let target = '/dashboard'
    try {
      const u = new URL(next, window.location.origin)
      if (u.origin === window.location.origin && !u.pathname.startsWith('//')) target = u.href // navigate to the checked, absolute same-origin URL
    } catch {}
    window.location.href = target
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await api<{ twoFactor: Factor[] | null; notice?: string }>('/api/auth/login', 'POST', f)
    setBusy(false)
    if (!r.ok) return setErr(r.error ?? 'Could not log in.')
    if (r.data.notice) setNotice(r.data.notice)
    if (r.data.twoFactor?.length) setMethods(r.data.twoFactor); else go()
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Log in</H1>
      <Card>
        {methods ? <>{notice && <div className="mb-4"><Notice tone="warn">{notice}</Notice></div>}<SecondStep methods={methods} onDone={go} /></> : (
          <form onSubmit={submit} className="space-y-4">
            {err && <Notice tone="error">{err}</Notice>}
            <Field label="Email"><Input required type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
            <Field label="Password"><Input required type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></Field>
            <Button disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Log in'}</Button>
            <div className="flex justify-between">
              <Muted><Link href="/forgot" className="text-brand hover:underline">Forgot password?</Link></Muted>
              <Muted><Link href="/signup" className="text-brand hover:underline">Create an account</Link></Muted>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
