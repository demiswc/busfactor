'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, Field, H1, Input, Muted, Notice } from '@/components/ui'

export default function SignupPage() {
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await api('/api/auth/signup', 'POST', f)
    setBusy(false)
    r.ok ? setDone(true) : setErr(r.error ?? 'Could not sign up.')
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Create your account</H1>
      <Card>
        {done ? (
          <Notice tone="ok">Check your inbox at <strong>{f.email}</strong> for a link to confirm your email, then <Link className="underline" href="/login">log in</Link>.</Notice>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {err && <Notice tone="error">{err}</Notice>}
            <Field label="Your name" hint="Your contacts will see this, e.g. “Is Alex OK?”">
              <Input required maxLength={100} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" />
            </Field>
            <Field label="Email">
              <Input required type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" />
            </Field>
            <Field label="Password" hint="At least 10 characters. A password manager is ideal.">
              <Input required type="password" minLength={10} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
            </Field>
            <Button disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create account'}</Button>
            <Muted>Already have an account? <Link href="/login" className="text-brand hover:underline">Log in</Link></Muted>
          </form>
        )}
      </Card>
    </div>
  )
}
