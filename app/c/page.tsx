'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/client'
import { Button, Card, H1, Muted, Notice } from '@/components/ui'

/** One-click check-in from a reminder email. The button press (POST) stops email scanners checking you in by accident. */
export default function CheckinLinkPage() {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  async function go() {
    setState('busy')
    const t = new URLSearchParams(window.location.search).get('t') ?? ''
    const r = await api<{ name?: string; message?: string }>('/api/checkin-link', 'POST', { t })
    if (r.ok) { setMsg(`Thanks${r.data.name ? `, ${r.data.name}` : ''}. You're checked in, and any alerts have been cancelled.`); setState('ok') }
    else { setMsg(r.data.message ?? r.error ?? 'That did not work.'); setState('error') }
  }
  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Check in</H1>
      <Card className="space-y-4">
        {state === 'ok' ? <Notice tone="ok">{msg}</Notice>
          : state === 'error' ? <><Notice tone="error">{msg}</Notice><Link href="/login?next=/dashboard" className="text-brand hover:underline">Log in instead</Link></>
          : <>
              <Muted>Press the button to tell busfactor you&apos;re OK. This resets your timer and cancels any alert in progress.</Muted>
              <Button onClick={go} disabled={state === 'busy'} className="w-full py-4 text-base">I&apos;m OK</Button>
            </>}
      </Card>
    </div>
  )
}
