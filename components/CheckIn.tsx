'use client'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Notice } from './ui'

export function CheckInButton({ urgent }: { urgent: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [err, setErr] = useState('')
  async function go() {
    setState('busy')
    const r = await api('/api/me/checkin')
    if (r.ok) { setState('done'); setTimeout(() => window.location.reload(), 900) }
    else { setErr(r.error ?? 'Could not check in.'); setState('error') }
  }
  return (
    <div className="space-y-3">
      <Button onClick={go} disabled={state === 'busy' || state === 'done'} variant={urgent ? 'danger' : 'primary'} className="px-8 py-4 text-base">
        {state === 'done' ? '✓ Checked in' : state === 'busy' ? 'Checking in…' : "I'm OK: check in"}
      </Button>
      {state === 'error' && <Notice tone="error">{err}</Notice>}
    </div>
  )
}

export function ResendVerification() {
  const [msg, setMsg] = useState('')
  return (
    <span>
      <button className="underline" onClick={async () => { const r = await api('/api/auth/resend-verification'); setMsg(r.ok ? 'Sent. Check your inbox.' : r.error ?? 'Could not send.') }}>
        Resend the confirmation email
      </button>
      {msg && <span className="ml-2">{msg}</span>}
    </span>
  )
}
