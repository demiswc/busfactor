'use client'
/**
 * "Check in from your phone": reminders as phone notifications instead of routine emails.
 * No app needed. Android: works in Chrome straight away. iPhone (iOS 16.4+): add busfactor to the
 * home screen first, then turn notifications on from there. On a computer we show a QR code to
 * open this step on the phone.
 */
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/client'
import { Button, Field, Input, Muted, Notice } from '@/components/ui'
import { ReauthBar, type Status } from '@/app/settings/SettingsClient'

type Env = { ios: boolean; android: boolean; standalone: boolean; supported: boolean; permission: NotificationPermission | 'unsupported' }
type Msg = { tone: 'ok' | 'error' | 'warn'; text: string } | null

function detect(): Env {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  return { ios, android, standalone, supported, permission: 'Notification' in window ? Notification.permission : 'unsupported' }
}

const defaultName = (e: Env) => (e.ios ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : e.android ? 'Android phone' : 'This computer')

function keyBytes(b64url: string) {
  const s = atob((b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not yet')

export function PhoneReminders({ st, reload, go }: { st: Status; reload: () => void; go: (id: 'login') => void }) {
  const [env, setEnv] = useState<Env | null>(null)
  const [qr, setQr] = useState('')
  const [thisId, setThisId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const phoneUrl = typeof window !== 'undefined' ? `${window.location.origin}/dashboard?s=phone` : ''

  const findThisDevice = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) { setThisId(null); return }
    const r = await api<{ id: string | null }>('/api/me/push/which', 'POST', { endpoint: sub.endpoint })
    setThisId(r.ok ? r.data.id : null)
  }, [])

  useEffect(() => {
    const e = detect(); setEnv(e); setName(defaultName(e))
    if (!e.ios && !e.android) QRCode.toDataURL(`${window.location.origin}/dashboard?s=phone`, { margin: 1, width: 200 }).then(setQr).catch(() => {})
    findThisDevice().catch(() => {})
  }, [findThisDevice, st.push.devices.length])

  async function turnOn() {
    setBusy(true); setMsg(null)
    try {
      // Ask first, straight from the tap: iPhones only allow the question in direct response to a tap.
      const perm = await Notification.requestPermission()
      setEnv(e => (e ? { ...e, permission: perm } : e))
      if (perm !== 'granted') { setMsg({ tone: 'warn', text: 'Notifications were not allowed. See below for how to turn them on.' }); return }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(st.push.publicKey) }))
      const r = await api('/api/me/push', 'POST', { subscription: sub.toJSON(), name })
      if (!r.ok) { setMsg({ tone: 'error', text: r.error ?? 'Could not save this device.' }); return }
      setMsg({ tone: 'ok', text: 'Reminders are on for this device. Send yourself a test to make sure.' })
      reload(); await findThisDevice()
    } catch (e) {
      setMsg({ tone: 'error', text: `This browser could not turn on notifications (${e instanceof Error ? e.message : 'unknown error'}).` })
    } finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg(null)
    const r = await api<{ delivered: number }>('/api/me/push/test', 'POST')
    setBusy(false)
    if (!r.ok) setMsg({ tone: 'error', text: r.error ?? 'Could not send.' })
    else setMsg(r.data.delivered ? { tone: 'ok', text: `Sent to ${r.data.delivered} device${r.data.delivered === 1 ? '' : 's'}. It should appear in a few seconds.` } : { tone: 'warn', text: 'No device could be reached. Turn reminders on again on your phone.' })
    reload()
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Stop sending reminders to "${label}"?`)) return
    const r = await api('/api/me/push/remove', 'POST', { id })
    setMsg(r.ok ? { tone: 'ok', text: 'Removed.' } : { tone: 'error', text: r.error ?? 'Could not remove.' })
    if (id === thisId) setThisId(null)
    reload()
  }

  async function setEmailToo(on: boolean) {
    const r = await api('/api/me', 'PUT', { reminder1Email: on })
    setMsg(r.ok ? { tone: 'ok', text: on ? 'The first reminder will also come by email.' : 'The first reminder will only go to your phone (unless it cannot be reached).' } : { tone: 'error', text: r.error ?? 'Could not save.' })
    reload()
  }

  if (!env) return <Muted>One moment…</Muted>
  const devices = st.push.devices
  const computer = !env.ios && !env.android
  const iphoneNeedsHomeScreen = env.ios && !env.standalone

  return (
    <div className="space-y-6">
      {/* On a computer: send them to their phone */}
      {computer && (
        <div className="flex flex-col gap-5 rounded-xl border border-black/10 p-5 sm:flex-row sm:items-center dark:border-white/10">
          {qr && <img src={qr} alt="QR code that opens this step on your phone" width={160} height={160} className="shrink-0 rounded-lg bg-white p-1" />}
          <div className="space-y-2 text-sm">
            <p className="text-base font-semibold">Do this on your phone</p>
            <p>Point your phone&apos;s camera at the code, or open <span className="font-medium">{phoneUrl.replace(/^https?:\/\//, '')}</span> on your phone and log in.</p>
            <p className="text-black/60 dark:text-white/60">It opens this same step there, with instructions for iPhone or Android. No app to install.</p>
          </div>
        </div>
      )}

      {/* iPhone in Safari: must be on the home screen first */}
      {iphoneNeedsHomeScreen && (
        <div className="space-y-3 rounded-xl border border-black/10 p-5 dark:border-white/10">
          <p className="text-base font-semibold">First, add busfactor to your home screen</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Tap the <span className="font-medium">Share</span> button (the square with an arrow pointing up). In Safari it is at the bottom of the screen; in Chrome, at the top right.</li>
            <li>Scroll down and tap <span className="font-medium">Add to Home Screen</span>, then <span className="font-medium">Add</span>.</li>
            <li>Close the browser and open <span className="font-medium">busfactor</span> from your home screen. Log in, then come back to &ldquo;Check in from your phone&rdquo;.</li>
          </ol>
          <Muted>iPhones only allow notifications from websites on the home screen. You need iOS 16.4 or newer (Settings → General → About).</Muted>
        </div>
      )}

      {/* This device can take notifications */}
      {!iphoneNeedsHomeScreen && (
        !env.supported ? (
          !computer && <Notice tone="warn">This browser cannot show notifications. On Android, use Chrome. On iPhone, use Safari and add busfactor to your home screen.</Notice>
        ) : thisId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <span>Reminders are on for <span className="font-medium">this {computer ? 'browser' : 'phone'}</span>.</span>
            <Button variant="secondary" onClick={test} disabled={busy}>Send a test notification</Button>
          </div>
        ) : env.permission === 'denied' ? (
          <Notice tone="warn">
            Notifications are blocked for busfactor on this device.{' '}
            {env.ios ? 'Open Settings → Notifications → busfactor and turn on Allow Notifications, then come back here.'
              : env.android ? 'Tap the icon to the left of the address (or ⋮ → Settings → Site settings), allow Notifications for this site, then reload this page.'
              : 'Click the icon to the left of the address, allow Notifications for this site, then reload this page.'}
          </Notice>
        ) : (
          <div className={`space-y-3 ${computer ? 'rounded-xl border border-black/10 p-5 dark:border-white/10' : ''}`}>
            {computer ? <p className="text-sm font-semibold">Or get reminders in this browser on this computer</p> : <p className="text-base font-semibold">Turn on reminders on this phone</p>}
            <ReauthBar until={st.confirmedUntil} reload={reload} />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Name for this device"><Input maxLength={60} value={name} onChange={e => setName(e.target.value)} /></Field>
              <Button onClick={turnOn} disabled={busy || !name.trim()} className={computer ? '' : 'py-3'}>Turn on reminders here</Button>
            </div>
            {env.android && !env.standalone && <Muted>Optional: in Chrome&apos;s menu (⋮), tap &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;, so busfactor opens like an app.</Muted>}
          </div>
        )
      )}

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {/* Devices on the account */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Your devices</h2>
        {devices.length > 0 && (thisId || iphoneNeedsHomeScreen || !env.supported || env.permission === 'denied') && <div className="mb-3"><ReauthBar until={st.confirmedUntil} reload={reload} /></div>}
        {devices.length === 0 ? <Muted>None yet. Until you add one, reminders come by email.</Muted> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
            {devices.map(d => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="font-medium">{d.name}{d.id === thisId && <span className="ml-2 rounded bg-black/5 px-2 py-0.5 text-xs font-normal dark:bg-white/10">this device</span>}</div>
                  <div className="text-xs text-black/55 dark:text-white/55">
                    Added {fmt(d.createdAt)} · last reached {fmt(d.lastOkAt)}{d.failures > 0 && <span className="text-red-600"> · {d.failures} failed</span>}
                  </div>
                </div>
                <button className="text-red-600 hover:underline" onClick={() => remove(d.id, d.name)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {devices.length > 0 && !thisId && <div className="mt-3"><Button variant="secondary" onClick={test} disabled={busy}>Send a test notification</Button></div>}
      </div>

      {devices.length > 0 && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={st.settings.reminder1Email} onChange={e => setEmailToo(e.target.checked)} />
          <span>Also email me the first reminder. <span className="text-black/55 dark:text-white/55">The second reminder always comes by email as well, in case your phone misses it.</span></span>
        </label>
      )}

      {devices.length > 0 && st.security.passkeys.length === 0 && (
        <Notice tone="info">
          Tip: add a passkey on your phone in &ldquo;Protect your login&rdquo;. Then a reminder can be confirmed with Face ID or your fingerprint.{' '}
          <button onClick={() => go('login')} className="font-medium underline">Protect your login</button>
        </Notice>
      )}
    </div>
  )
}
