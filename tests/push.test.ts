/**
 * Phone reminders (Web Push): who gets what, fallbacks to email, dead devices, and the SSRF guard.
 * Needs TEST_DATABASE_URL, like flow.test.ts.
 */
import './env'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'crypto'
import webpush from 'web-push'
import { buildDdl } from './ddl'
import { db } from '../lib/db'
import { emailHash, encPii } from '../lib/crypto'
import { setMailSender, type Mail } from '../lib/mail'
import { isPushEndpoint, parseSubscription, setPushTransport, vapidKeys } from '../lib/push'
import * as svc from '../lib/engine/service'
import { checkinPasskeyOptions } from '../lib/twofactor'

const DAY = 86_400_000
const outbox: Mail[] = []
const pushes: Array<{ endpoint: string; payload: { title: string; url: string; urgent: boolean } }> = []
let failWith: Record<string, number> = {}
const ago = (ms: number) => new Date(Date.now() - ms)
const clear = () => { outbox.length = 0; pushes.length = 0 }
const fakeSub = (id: string) => {
  const e = createECDH('prime256v1'); e.generateKeys()
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
}
let uid = ''
const OWNER = 'pia@example.com'

before(async () => {
  await db.$transaction(async tx => { for (const s of buildDdl()) await tx.$executeRawUnsafe(s) }, { timeout: 60_000, maxWait: 30_000 })
  setMailSender(async m => { outbox.push(m); return { ok: true } })
  setPushTransport(async (sub, payload) => {
    const code = Object.entries(failWith).find(([k]) => sub.endpoint.endsWith(k))?.[1]
    if (code) throw Object.assign(new Error('push failed'), { statusCode: code })
    pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
    return { statusCode: 201 }
  })
  const u = await db.user.create({ data: { nameEnc: encPii('Pia'), emailEnc: encPii(OWNER), emailHash: emailHash(OWNER), passwordHash: 'x', emailVerifiedAt: new Date(), switch: { create: { enabled: true, lastCheckinAt: new Date() } } } })
  uid = u.id
  // Minimum people so no "cannot hand over" warnings get in the way.
  for (const [role, email] of [['CONFIRMER', 'c@example.com'], ['TRUSTED', 't@example.com']] as const) {
    await db.nominee.create({ data: { userId: uid, role, status: 'ACCEPTED', nameEnc: encPii(role), emailEnc: encPii(email), emailHash: emailHash(email), acceptedAt: new Date() } })
  }
})
after(async () => { setPushTransport(null); await db.$disconnect() })

const dueFor = async (n: 1 | 2) => {
  await db.switch.update({ where: { userId: uid }, data: { stage: n === 1 ? 'ACTIVE' : 'REMINDER_1', lastCheckinAt: ago((n === 1 ? 14 : 19) * DAY + 60_000), stageChangedAt: ago(2 * DAY) } })
  clear(); await svc.tickUser(uid)
}

test('only real push services are accepted (the server never calls an arbitrary address)', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x'))
  assert.ok(isPushEndpoint('https://web.push.apple.com/abc'))
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'))
  assert.ok(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'))
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.example/fcm.googleapis.com', 'https://push.apple.com.evil.example/x', 'https://169.254.169.254/latest', 'https://localhost/x']) {
    assert.equal(isPushEndpoint(bad), false, bad)
  }
  assert.throws(() => parseSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth: 'x' } }), /key/)
  assert.doesNotThrow(() => parseSubscription(fakeSub('ok')))
})

test('the server key is created once, stored encrypted, and really encrypts a notification', async () => {
  const a = await vapidKeys(), b = await vapidKeys()
  assert.equal(a.publicKey, b.publicKey)
  const row = await db.systemState.findUniqueOrThrow({ where: { key: 'vapid' } })
  assert.ok(!row.value.includes(a.privateKey), 'private key is not stored readable')
  const req = webpush.generateRequestDetails(fakeSub('enc'), 'hello', { vapidDetails: { subject: 'mailto:x@example.com', publicKey: a.publicKey, privateKey: a.privateKey } })
  assert.equal(req.method, 'POST'); assert.ok(req.headers.Authorization); assert.ok((req.body as Buffer).length > 5)
})

test('no phone: reminders come by email exactly as before', async () => {
  await dueFor(1)
  assert.equal(pushes.length, 0)
  assert.equal(outbox.filter(m => m.to === OWNER && /check-in/i.test(m.subject)).length, 1)
})

test('with a phone: first reminder goes to the phone only, and its link checks in', async () => {
  const d = await svc.addPushDevice(uid, fakeSub('phone1'), "Pia's iPhone")
  assert.ok(d.isNew)
  assert.ok(outbox.some(m => /added as a device/.test(m.html)), 'owner told a device was added')
  await dueFor(1)
  assert.equal(pushes.length, 1)
  assert.match(pushes[0].payload.title, /Time for your check-in/)
  assert.equal(outbox.filter(m => /Time for your/.test(m.subject)).length, 0, 'no reminder email')
  const t = new URL(pushes[0].payload.url).searchParams
  assert.equal(t.get('via'), 'phone')
  assert.equal(await checkinPasskeyOptions(t.get('t')!), null, 'no passkeys: plain one-tap check-in')
  const r = await svc.checkInWithLink(t.get('t')!, 'phone notification')
  assert.ok(r.ok)
  assert.equal((await db.switch.findUniqueOrThrow({ where: { userId: uid } })).stage, 'ACTIVE')
  assert.equal((await svc.checkInWithLink(t.get('t')!)).ok, false, 'link works once')
})

test('"also email me" sends the first reminder both ways; the second reminder always does', async () => {
  await svc.updateSettings(uid, { reminder1Email: true })
  await dueFor(1)
  assert.equal(pushes.length, 1); assert.equal(outbox.filter(m => /Time for your/.test(m.subject)).length, 1)
  await svc.updateSettings(uid, { reminder1Email: false })
  await dueFor(2)
  assert.equal(pushes.length, 1); assert.equal(pushes[0].payload.urgent, true)
  assert.equal(outbox.filter(m => /Second reminder/.test(m.subject)).length, 1)
})

test('if the phone cannot be reached, the first reminder falls back to email', async () => {
  failWith = { phone1: 500 }
  await dueFor(1)
  assert.equal(pushes.length, 0)
  assert.equal(outbox.filter(m => /Time for your/.test(m.subject)).length, 1)
  const dev = await db.pushDevice.findFirstOrThrow({ where: { userId: uid } })
  assert.equal(dev.failures, 1, 'kept for now, failure counted')
  failWith = {}
})

test('a phone the push service says is gone is removed, and the owner is emailed', async () => {
  await svc.addPushDevice(uid, fakeSub('phone2'), 'Old Android')
  failWith = { phone2: 410 }
  await dueFor(1)
  assert.equal(pushes.length, 1, 'the working phone still got it')
  assert.equal(await db.pushDevice.count({ where: { userId: uid } }), 1)
  assert.ok(outbox.some(m => /"Old Android" have stopped/.test(m.subject)))
  failWith = {}
})

test('contacts being asked also reaches the phone, urgently', async () => {
  await db.switch.update({ where: { userId: uid }, data: { stage: 'REMINDER_2', lastCheckinAt: ago(20 * DAY + 60_000), stageChangedAt: ago(2 * DAY) } })
  clear(); await svc.tickUser(uid)
  assert.equal((await db.switch.findUniqueOrThrow({ where: { userId: uid } })).stage, 'NOMINEES_ALERTED')
  assert.ok(pushes.some(p => /being asked/.test(p.payload.title) && p.payload.urgent))
  await svc.checkIn(uid)
})

test('devices belong to one account; removing one tells the owner', async () => {
  const other = await db.user.create({ data: { nameEnc: encPii('Ola'), emailEnc: encPii('ola@example.com'), emailHash: emailHash('ola@example.com'), passwordHash: 'x' } })
  const [dev] = await db.pushDevice.findMany({ where: { userId: uid } })
  await svc.removePushDevice(other.id, dev.id)
  assert.equal(await db.pushDevice.count({ where: { id: dev.id } }), 1, "cannot remove someone else's device")
  clear(); await svc.removePushDevice(uid, dev.id)
  assert.equal(await db.pushDevice.count({ where: { userId: uid } }), 0)
  assert.ok(outbox.some(m => /no longer receive your check-in reminders/.test(m.html)))
})
