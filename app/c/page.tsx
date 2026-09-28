'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '@/lib/client'
import { Button, Card, H1, Muted, Notice } from '@/components/ui'

type Options = Parameters<typeof startAuthentication>[0]['optionsJSON']

/**
 * Check in from a reminder (email or phone notification). Nothing happens on page load, so email
 * scanners cannot check you in by accident. If you have a passkey, you confirm with Face ID,
 * fingerprint or your security key; otherwise one press does it.
 */
export default function CheckinLinkPage() {
  const [state, setState] = useState<'loading' | 'idle' | 'busy' | 'ok' | 'error'>('loading')
  const [msg, setMsg] = useState('')
  const [options, setOptions] = useState<Options | null>(null)
  const [passkeyFailed, setPasskeyFailed] = useState('')
  const params = () => new URLSearchParams(window.location.search)
  const t = () => params().get('t') ?? ''
  const via = () => params().get('via') ?? ''

  useEffect(() => {
    (async () => {
      const r = await api<{ options: Options | null }>('/api/checkin-link/passkey/options', 'POST', { t: t() })
      if (!r.ok) { setMsg(r.error ?? 'This check-in link has already been used or has expired.'); setState('error'); return }
      setOptions(r.data.options); setState('idle')
    })()
  }, [])

  const done = (name?: string) => { setMsg(`Thanks${name ? `, ${name}` : ''}. You're checked in, and any alerts have been cancelled.`); setState('ok') }

  async function withPasskey() {
    if (!options) return
    setState('busy'); setPasskeyFailed('')
    try {
      const response = await startAuthentication({ optionsJSON: options })
      const r = await api<{ name?: string; message?: string }>('/api/checkin-link/passkey', 'POST', { t: t(), response, via: via() })
      if (r.ok) return done(r.data.name)
      setPasskeyFailed(r.data?.message ?? r.error ?? 'That did not work.')
    } catch {
      setPasskeyFailed('The passkey was cancelled or is not on this device.')
    }
    // A challenge works once: get a fresh one for another try.
    const again = await api<{ options: Options | null }>('/api/checkin-link/passkey/options', 'POST', { t: t() })
    if (again.ok) { setOptions(again.data.options); setState('idle') } else { setMsg(again.error ?? 'This link has expired.'); setState('error') }
  }

  async function withoutPasskey() {
    setState('busy')
    const r = await api<{ name?: string; message?: string }>('/api/checkin-link', 'POST', { t: t(), via: via() })
    if (r.ok) done(r.data.name)
    else { setMsg(r.data?.message ?? r.error ?? 'That did not work.'); setState('error') }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <H1>Check in</H1>
      <Card className="space-y-4">
        {state === 'loading' ? <Muted>One moment…</Muted>
          : state === 'ok' ? <Notice tone="ok">{msg}</Notice>
          : state === 'error' ? <><Notice tone="error">{msg}</Notice><Link href="/login?next=/dashboard" className="text-brand hover:underline">Log in instead</Link></>
          : options ? <>
              <Muted>Confirm it&apos;s you to tell busfactor you&apos;re OK. This resets your timer and cancels any alert in progress.</Muted>
              <Button onClick={withPasskey} disabled={state === 'busy'} className="w-full py-4 text-base">I&apos;m OK: confirm with my passkey</Button>
              <Muted>Face ID, fingerprint, Windows Hello or your security key.</Muted>
              {passkeyFailed && <Notice tone="warn">{passkeyFailed}</Notice>}
              <button onClick={withoutPasskey} disabled={state === 'busy'} className="text-sm text-brand hover:underline">No passkey on this device? Check in without it</button>
            </>
          : <>
              <Muted>Press the button to tell busfactor you&apos;re OK. This resets your timer and cancels any alert in progress.</Muted>
              <Button onClick={withoutPasskey} disabled={state === 'busy'} className="w-full py-4 text-base">I&apos;m OK</Button>
            </>}
      </Card>
    </div>
  )
}
