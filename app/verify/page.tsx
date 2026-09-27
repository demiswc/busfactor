'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, H1, Muted, Notice } from '@/components/ui'

/** Confirmation needs a button press, so email link scanners cannot use up the single-use link. */
export default function VerifyPage() {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const [err, setErr] = useState('')
  async function confirm() {
    setState('busy')
    const t = new URLSearchParams(window.location.search).get('t') ?? ''
    const r = await api('/api/auth/verify', 'POST', { t })
    if (r.ok) setState('ok'); else { setErr(r.error ?? 'Could not confirm.'); setState('error') }
  }
  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Confirm your email</H1>
      <Card className="space-y-4">
        {state === 'ok' ? <Notice tone="ok">Email confirmed. <Link className="underline" href="/dashboard">Continue to your dashboard</Link>.</Notice>
          : state === 'error' ? <Notice tone="error">{err}</Notice>
          : <><Muted>Press the button to confirm this is your email address.</Muted><Button onClick={confirm} disabled={state === 'busy'} className="w-full">Confirm my email</Button></>}
      </Card>
    </div>
  )
}
