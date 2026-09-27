'use client'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, Field, H1, Input, Notice } from '@/components/ui'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Reset your password</H1>
      <Card>
        {done ? <Notice tone="ok">If an account exists for that email, a reset link is on its way. It works for one hour.</Notice> : (
          <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); await api('/api/auth/forgot', 'POST', { email }); setBusy(false); setDone(true) }}>
            <Field label="Email"><Input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
            <Button disabled={busy} className="w-full">Send reset link</Button>
          </form>
        )}
      </Card>
    </div>
  )
}
