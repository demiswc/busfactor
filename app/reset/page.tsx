'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, Field, H1, Input, Notice } from '@/components/ui'

export default function ResetPage() {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const t = new URLSearchParams(window.location.search).get('t') ?? ''
    const r = await api('/api/auth/reset', 'POST', { t, password })
    setBusy(false)
    r.ok ? setDone(true) : setErr(r.error ?? 'Could not reset password.')
  }
  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Choose a new password</H1>
      <Card>
        {done ? <Notice tone="ok">Password changed. <Link className="underline" href="/login">Log in</Link> with your new password.</Notice> : (
          <form className="space-y-4" onSubmit={submit}>
            {err && <Notice tone="error">{err}</Notice>}
            <Field label="New password" hint="At least 10 characters."><Input required type="password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            <Button disabled={busy} className="w-full">Save new password</Button>
          </form>
        )}
      </Card>
    </div>
  )
}
