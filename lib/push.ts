/**
 * Phone and browser notifications (Web Push). No app is needed: Android browsers support it directly,
 * and iPhones (iOS 16.4+) once busfactor has been added to the home screen.
 *
 * The server's signing key pair (VAPID) is created on first use and stored in the database, with the
 * private half encrypted, so nobody has to configure anything. Subscriptions are stored encrypted.
 * A notification never checks anyone in: it only carries a link to a page where the owner confirms.
 */
import webpush, { type PushSubscription } from 'web-push'
import { db } from './db'
import { appUrl } from './config'
import { decPii, encPii, lookupHash } from './crypto'
import { UserError } from './errors'

const VAPID_KEY = 'vapid'
export const MAX_PUSH_DEVICES = 10
const GIVE_UP_AFTER_FAILURES = 5

type Vapid = { publicKey: string; privateKey: string }
let cached: Vapid | null = null

export async function vapidKeys(): Promise<Vapid> {
  if (cached) return cached
  const row = await db.systemState.findUnique({ where: { key: VAPID_KEY } })
  if (row) {
    const v = JSON.parse(row.value) as { publicKey: string; privateKeyEnc: string }
    return (cached = { publicKey: v.publicKey, privateKey: decPii(v.privateKeyEnc) })
  }
  const fresh = webpush.generateVAPIDKeys()
  try {
    await db.systemState.create({ data: { key: VAPID_KEY, value: JSON.stringify({ publicKey: fresh.publicKey, privateKeyEnc: encPii(fresh.privateKey) }) } })
    return (cached = fresh)
  } catch {
    cached = null // another process created it first: use theirs
    return vapidKeys()
  }
}

/** Only real push services, so a subscription can never make the server call an arbitrary address. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]
export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(r => r.test(u.hostname))
  } catch { return false }
}

const B64URL = /^[A-Za-z0-9_-]+$/
export function parseSubscription(raw: unknown): PushSubscription {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : ''
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : ''
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : ''
  if (endpoint.length > 1000 || !isPushEndpoint(endpoint)) throw new UserError('This browser gave an unexpected notification address. Please try another browser.')
  if (!B64URL.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65 || !B64URL.test(auth) || Buffer.from(auth, 'base64url').length !== 16) {
    throw new UserError('This browser gave an unexpected notification key. Please try again.')
  }
  return { endpoint, keys: { p256dh, auth } }
}

export const endpointHash = (endpoint: string) => lookupHash('push', endpoint)

export interface PushMessage { title: string; body: string; url: string; tag?: string; urgent?: boolean }

type Transport = (sub: PushSubscription, payload: string, opts: webpush.RequestOptions) => Promise<{ statusCode: number }>
let transport: Transport = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts)
/** Tests swap the network call for a fake one. */
export function setPushTransport(t: Transport | null) { transport = t ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts)) }

export interface PushResult { delivered: number; failed: number; removed: string[] }

/** Sends to every device the user has. Devices the push service says are gone (or that keep failing) are removed. */
export async function pushToUser(userId: string, msg: PushMessage): Promise<PushResult> {
  const devices = await db.pushDevice.findMany({ where: { userId } })
  const out: PushResult = { delivered: 0, failed: 0, removed: [] }
  if (!devices.length) return out
  const v = await vapidKeys()
  const subject = process.env.OPERATOR_EMAIL ? `mailto:${process.env.OPERATOR_EMAIL}` : appUrl()
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, urgent: !!msg.urgent })
  await Promise.all(devices.map(async d => {
    let gone = false
    try {
      const sub = JSON.parse(decPii(d.subEnc)) as PushSubscription
      await transport(sub, payload, {
        vapidDetails: { subject, publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 24 * 60 * 60, urgency: msg.urgent ? 'high' : 'normal', timeout: 10_000,
      })
      await db.pushDevice.update({ where: { id: d.id }, data: { lastOkAt: new Date(), failures: 0 } })
      out.delivered++
      return
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      gone = code === 404 || code === 410 || d.failures + 1 >= GIVE_UP_AFTER_FAILURES
      out.failed++
    }
    if (gone) {
      await db.pushDevice.deleteMany({ where: { id: d.id } })
      out.removed.push(decPii(d.nameEnc))
    } else {
      await db.pushDevice.update({ where: { id: d.id }, data: { lastFailAt: new Date(), failures: { increment: 1 } } })
    }
  }))
  return out
}

export async function listPushDevices(userId: string) {
  const rows = await db.pushDevice.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.map(r => ({ id: r.id, name: decPii(r.nameEnc), createdAt: r.createdAt, lastOkAt: r.lastOkAt, lastFailAt: r.lastFailAt, failures: r.failures }))
}

/** Adds (or renames) a device. Returns whether it was new. */
export async function savePushDevice(userId: string, rawSub: unknown, rawName: unknown): Promise<{ id: string; isNew: boolean; name: string }> {
  const sub = parseSubscription(rawSub)
  const name = (typeof rawName === 'string' ? rawName : '').trim().slice(0, 60) || 'My phone'
  const hash = endpointHash(sub.endpoint)
  const existing = await db.pushDevice.findUnique({ where: { endpointHash: hash } })
  if (existing && existing.userId === userId) {
    await db.pushDevice.update({ where: { id: existing.id }, data: { nameEnc: encPii(name), subEnc: encPii(JSON.stringify(sub)), failures: 0 } })
    return { id: existing.id, isNew: false, name }
  }
  // The same browser was used by another account before: it now belongs to this one.
  if (existing) await db.pushDevice.delete({ where: { id: existing.id } })
  if ((await db.pushDevice.count({ where: { userId } })) >= MAX_PUSH_DEVICES) throw new UserError(`You can have up to ${MAX_PUSH_DEVICES} devices. Remove one first.`)
  const row = await db.pushDevice.create({ data: { userId, endpointHash: hash, subEnc: encPii(JSON.stringify(sub)), nameEnc: encPii(name) } })
  return { id: row.id, isNew: true, name }
}

export async function findPushDevice(userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string' || !endpoint) return null
  const row = await db.pushDevice.findUnique({ where: { endpointHash: endpointHash(endpoint) } })
  return row && row.userId === userId ? row.id : null
}
