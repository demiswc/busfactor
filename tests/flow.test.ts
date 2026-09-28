/**
 * End-to-end switch scenarios against a real MariaDB database.
 * Needs TEST_DATABASE_URL (a throwaway database; tables are recreated from prisma/schema.prisma).
 */
import './env'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { createHmac } from 'crypto'
import { buildDdl } from './ddl'
import { db } from '../lib/db'
import { emailHash, encPii } from '../lib/crypto'
import { setMailSender, type Mail } from '../lib/mail'
import * as svc from '../lib/engine/service'
import { sealText, openSealed, createRecipientKeys, sealForRecipient, openForRecipient } from '../lib/sealed'

const H = 3_600_000, DAY = 24 * H
const outbox: Mail[] = []
const to = (who: string) => outbox.filter(m => m.to === who)
const clear = () => { outbox.length = 0 }
const linkIn = (m: Mail | undefined, path: string) => m?.html.match(new RegExp(`${path}\\?t=([A-Za-z0-9_-]+)`))?.[1] ?? ''
const lastLink = (who: string, path: string) => linkIn([...outbox].reverse().find(m => m.to === who && m.html.includes(path)), path)
const ago = (ms: number) => new Date(Date.now() - ms)

const OWNER = 'alex@example.com', A = 'sam@example.com', B = 'jo@example.com', T = 'pat@example.com'
let uid = ''
const PAT_PASS = 'pat chose this passphrase'
const newUser = (name: string, email: string, sw: Record<string, unknown> = {}) =>
  db.user.create({ data: { nameEnc: encPii(name), emailEnc: encPii(email), emailHash: emailHash(email), passwordHash: 'x', emailVerifiedAt: new Date(), switch: { create: sw } } })
const nomineeBy = (email: string) => db.nominee.findFirstOrThrow({ where: { emailHash: emailHash(email) } })

async function sw() { return db.switch.findUniqueOrThrow({ where: { userId: uid } }) }
async function setSw(data: Record<string, unknown>) { await db.switch.update({ where: { userId: uid }, data }) }
/** Jump to the moment contacts are due to be asked, and tick. */
async function toAlert() {
  await setSw({ lastCheckinAt: ago(20 * DAY), stage: 'REMINDER_2', stageChangedAt: ago(13 * H) })
  clear(); await svc.tickUser(uid)
}

before(async () => {
  // One connection for the whole setup, so FOREIGN_KEY_CHECKS=0 applies to every statement.
  await db.$transaction(async tx => { for (const stmt of buildDdl()) await tx.$executeRawUnsafe(stmt) }, { timeout: 60_000 })
  setMailSender(async m => { outbox.push(m); return { ok: true } })
  uid = (await newUser('Alex', OWNER)).id
})
after(async () => { await db.$disconnect() })

test('invitations: only accepted contacts count', async () => {
  for (const [name, email, role] of [['Sam', A, 'CONFIRMER'], ['Jo', B, 'CONFIRMER'], ['Pat', T, 'TRUSTED']] as const) {
    clear(); await svc.addNominee(uid, { name, email, role })
    const inv = linkIn(to(email)[0], '/n/invite')
    assert.ok(inv.length > 30, `invite link for ${name}`)
    assert.equal((await svc.lookupInvite(inv)).valid, true)
    if (role === 'TRUSTED') {
      assert.equal((await svc.answerInvite(inv, true)).ok, false, 'trusted person must choose a passphrase')
      const keys = await createRecipientKeys(PAT_PASS)
      assert.equal((await svc.answerInvite(inv, true, { ...keys, hint: 'the usual one' })).ok, true)
    } else await svc.answerInvite(inv, true)
    assert.equal((await svc.lookupInvite(inv)).valid, false, 'invite link is single use')
  }
  await assert.rejects(svc.addNominee(uid, { name: 'Me', email: OWNER, role: 'CONFIRMER' }), /other people/)
  await assert.rejects(svc.addNominee(uid, { name: 'Sam again', email: A, role: 'CONFIRMER' }), /already/)
  const st = await svc.getStatus(uid)
  assert.equal(st.nominees.filter(n => n.status === 'ACCEPTED').length, 3)
  assert.ok(!JSON.stringify(st).includes('inviteTokenHash'))
})

test('owner reminders then contacts asked; trusted person not contacted', async () => {
  await svc.updateSettings(uid, { enabled: true })
  await svc.setInstructions(uid, { mode: 'SERVER', text: 'Safe behind the painting, code 0000.' })
  const raw = await sw()
  assert.ok(raw.instructions && !raw.instructions.includes('0000'), 'instructions encrypted at rest')

  clear(); await svc.tickUser(uid); assert.equal(outbox.length, 0, 'day 0 quiet')
  await setSw({ lastCheckinAt: ago(14 * DAY) }); clear(); await svc.tickUser(uid)
  assert.equal(outbox.length, 1); assert.equal(outbox[0].to, OWNER)
  clear(); await svc.tickUser(uid); assert.equal(outbox.length, 0, 'no duplicate reminder')
  await setSw({ lastCheckinAt: ago(19 * DAY), stageChangedAt: ago(13 * H) }); clear(); await svc.tickUser(uid)
  assert.match(outbox[0].subject, /Second reminder/)
  await toAlert()
  assert.equal(to(A).length, 1); assert.equal(to(B).length, 1); assert.equal(to(T).length, 0)
  assert.equal((await sw()).stage, 'NOMINEES_ALERTED')
  const raws = await db.responseToken.findMany()
  assert.ok(!JSON.stringify(raws).includes(lastLink(A, '/n/respond')), 'only token hashes stored')
})

test('two "not OK" answers -> hold; check-in cancels and revokes links', async () => {
  const la = lastLink(A, '/n/respond'), lb = lastLink(B, '/n/respond')
  assert.equal((await svc.respond(la, 'NOT_OK')).ok, true)
  assert.equal((await svc.respond(la, 'NOT_OK')).ok, false, 'one vote per link')
  assert.equal((await sw()).stage, 'NOMINEES_ALERTED')
  clear(); await svc.respond(lb, 'NOT_OK')
  const s = await sw()
  assert.equal(s.stage, 'HOLD'); assert.equal(s.holdReason, 'CONFIRMED')
  assert.ok(Math.abs(s.holdEndsAt!.getTime() - (Date.now() + 48 * H)) < 10_000)
  assert.equal(to(OWNER).length, 1); assert.equal(to(T).length, 0)
  clear(); await svc.checkIn(uid)
  assert.equal((await sw()).stage, 'ACTIVE')
  assert.equal(to(A).length + to(B).length, 2, 'all clear to both contacts'); assert.equal(to(T).length, 0)
  assert.equal((await svc.lookupRespond(lb)).valid, false, 'old links revoked')
})

test('full handover: trusted person gets a link; instructions only after pressing open', async () => {
  await toAlert()
  await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK'); await svc.respond(lastLink(B, '/n/respond'), 'NOT_OK')
  await setSw({ holdEndsAt: ago(1000) }); clear(); await svc.tickUser(uid)
  assert.equal((await sw()).stage, 'HANDOVER_SENT')
  const mail = to(T)[0]
  assert.ok(mail && !mail.html.includes('0000'), 'secret is not in the email')
  const link = linkIn(mail, '/n/handover')
  const look = await svc.lookupHandover(link)
  assert.equal(look.valid, true)
  const opened = await svc.openHandover(link)
  assert.ok(opened.ok && opened.general.mode === 'SERVER' && opened.general.text.includes('0000'))
  assert.ok(!to(A).some(m => m.html.includes('0000')), 'contacts never see the secret')
  clear(); await svc.tickUser(uid); assert.equal(outbox.length, 0, 'handover never twice')
  clear(); await svc.checkIn(uid)
  assert.equal(to(T).length, 1, 'trusted person told it was a false alarm')
  assert.equal((await svc.openHandover(link)).ok, false, 'handover link revoked by check-in')
})

test('one "not OK", other silent -> reminder -> first answer trusted', async () => {
  await toAlert(); await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK')
  await setSw({ stageChangedAt: ago(71 * H) }); clear(); await svc.tickUser(uid)
  assert.equal(outbox.length, 0)
  await setSw({ stageChangedAt: ago(72 * H) }); clear(); await svc.tickUser(uid)
  assert.equal(to(B).length, 1); assert.equal(to(A).length, 0); assert.equal(to(OWNER).length, 1); assert.equal(to(T).length, 0)
  clear(); await svc.tickUser(uid); assert.equal(outbox.length, 0, 'reminder once')
  await setSw({ nomineeReminderSentAt: ago(24 * H) }); clear(); await svc.tickUser(uid)
  const s = await sw(); assert.equal(s.stage, 'HOLD'); assert.equal(s.holdReason, 'ONE_CONFIRMED_NO_REPLY')
  await setSw({ holdEndsAt: ago(1000) }); clear(); await svc.tickUser(uid)
  assert.match(to(T)[0].html, /others did not reply/)
  await svc.checkIn(uid)
})

test('nobody answers -> both reminded -> handover', async () => {
  await toAlert(); await setSw({ stageChangedAt: ago(72 * H) }); clear(); await svc.tickUser(uid)
  assert.equal(to(A).length, 1); assert.equal(to(B).length, 1); assert.equal(to(OWNER).length, 1)
  await setSw({ nomineeReminderSentAt: ago(24 * H) }); clear(); await svc.tickUser(uid)
  assert.equal((await sw()).holdReason, 'NO_REPLIES')
  await svc.checkIn(uid)
})

test('reminded contact answers OK via new link -> reset', async () => {
  await toAlert(); await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK')
  await setSw({ stageChangedAt: ago(72 * H) }); clear(); await svc.tickUser(uid)
  const late = lastLink(B, '/n/respond'); clear()
  const r = await svc.respond(late, 'OK')
  assert.ok(r.ok); assert.equal((await sw()).stage, 'ACTIVE')
  assert.equal(to(OWNER).length, 1); assert.equal(to(A).length, 1, 'Sam told all clear'); assert.equal(to(B).length, 0)
})

test('sealed instructions: server stores only the sealed box', async () => {
  const sealed = await sealText('Vault code 9876', 'our shared passphrase')
  await svc.setInstructions(uid, { mode: 'SEALED', sealed, hint: 'The name of our first dog' })
  await assert.rejects(svc.setInstructions(uid, { mode: 'SEALED', sealed: 'plain text' }), /damaged/)
  await toAlert()
  await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK'); await svc.respond(lastLink(B, '/n/respond'), 'NOT_OK')
  await setSw({ holdEndsAt: ago(1000) }); clear(); await svc.tickUser(uid)
  assert.match(to(T)[0].html, /passphrase/)
  const o = await svc.openHandover(lastLink(T, '/n/handover'))
  assert.ok(o.ok && o.general.mode === 'SEALED')
  assert.equal(await openSealed(o.general.sealed, 'our shared passphrase'), 'Vault code 9876')
  await svc.checkIn(uid)
})

test('single confirmer: one "not OK" is enough', async () => {
  const b = await nomineeBy(B)
  await db.nominee.update({ where: { id: b.id }, data: { status: 'DECLINED' } })
  await toAlert(); const r = await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK')
  assert.equal((await sw()).stage, 'HOLD')
  assert.match(r.message, /safety wait/)
  await svc.checkIn(uid)
  await db.nominee.update({ where: { id: b.id }, data: { status: 'ACCEPTED' } })
})

test('guards: pause, contacts locked during alert, validation, test emails', async () => {
  await setSw({ pausedUntil: new Date(Date.now() + 10 * DAY), lastCheckinAt: ago(40 * DAY) }); clear(); await svc.tickUser(uid)
  assert.equal(outbox.length, 0)
  await setSw({ pausedUntil: null, lastCheckinAt: new Date() })
  await toAlert()
  const n = await nomineeBy(A)
  await assert.rejects(svc.removeNominee(uid, n.id), /Check in first/)
  await svc.checkIn(uid)
  await assert.rejects(svc.updateSettings(uid, { reminder1AfterDays: 10, reminder2AfterDays: 5 }), /increase/)
  await assert.rejects(svc.updateSettings(uid, { pausedUntil: new Date(Date.now() + 200 * DAY).toISOString() }), /90 days/)
  clear(); const t = await svc.sendTestEmails(uid)
  assert.equal(t.sent, t.total); assert.ok(outbox.every(m => m.to === OWNER && m.subject.startsWith('[TEST]')))
  await assert.rejects(svc.sendTestEmails(uid), /wait/)
})

test('tickAll handles many users and isolates them', async () => {
  const u2 = await newUser('Bea', 'bea@example.com', { enabled: true, lastCheckinAt: ago(14 * DAY) })
  clear(); const r = await svc.tickAll()
  assert.ok(r.checked >= 2)
  // Bea gets her reminder, plus a warning that her switch has nobody to ask or hand over to
  assert.equal(to('bea@example.com').length, 2)
  assert.ok(to('bea@example.com').some(m => /cannot hand over/.test(m.subject)))
  assert.equal(to(OWNER).length, 0, 'Alex unaffected')
  clear(); await svc.tickAll()
  assert.ok(!to('bea@example.com').some(m => /cannot hand over/.test(m.subject)), 'warning is not repeated every tick')
  // and she cannot switch on again from scratch without people
  await svc.updateSettings(u2.id, { enabled: false })
  await assert.rejects(svc.updateSettings(u2.id, { enabled: true }), /at least one confirmer and one trusted person/)
  const other = await db.nominee.findFirstOrThrow({ where: { userId: uid } })
  await assert.rejects(svc.resendInvite(u2.id, other.id), /not found/, "cannot touch another user's contacts")
})

test('personal message: sealed to the trusted person, only they can open it', async () => {
  const pat = await nomineeBy(T)
  const box = await sealForRecipient(JSON.stringify({ text: 'Pat, the blue folder.', files: [{ name: 'servers.txt', type: 'text/plain', size: 4, data: btoa('beast') }] }), pat.publicKey!)
  await svc.setMessage(uid, pat.id, box, 30)
  await assert.rejects(svc.setMessage(uid, (await nomineeBy(A)).id, box, 30), /handover/, 'only for trusted people')
  await assert.rejects(svc.setMessage(uid, pat.id, 'not a box', 3), /damaged/)
  const raw = await db.message.findUniqueOrThrow({ where: { nomineeId: pat.id } })
  assert.ok(!raw.box.includes('blue folder'))
  await toAlert()
  await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK'); await svc.respond(lastLink(B, '/n/respond'), 'NOT_OK')
  await setSw({ holdEndsAt: ago(1000) }); clear(); await svc.tickUser(uid)
  assert.match(to(T)[0].html, /personal message/)
  const o = await svc.openHandover(lastLink(T, '/n/handover'))
  assert.ok(o.ok && o.personal)
  const payload = JSON.parse(await openForRecipient(o.personal.box, o.personal.encPrivateKey, PAT_PASS))
  assert.equal(payload.text, 'Pat, the blue folder.'); assert.equal(atob(payload.files[0].data), 'beast')
  assert.equal(o.personal.hint, 'the usual one')
  await svc.checkIn(uid)
})

test('one-click check-in link from a reminder email: works once, cancels alerts', async () => {
  await toAlert()
  const link = lastLink(OWNER, '/c') || linkIn([...outbox].reverse().find(m => m.html.includes('/c?t=')), '/c')
  await setSw({ lastCheckinAt: ago(14 * DAY), stage: 'ACTIVE', stageChangedAt: ago(13 * H) }); clear(); await svc.tickUser(uid)
  const t = linkIn(to(OWNER)[0], '/c')
  assert.ok(t.length > 30, 'reminder contains a check-in link')
  const r = await svc.checkInWithLink(t)
  assert.ok(r.ok); assert.equal((await sw()).stage, 'ACTIVE')
  assert.ok(Date.now() - (await sw()).lastCheckinAt!.getTime() < 5000)
  assert.equal((await svc.checkInWithLink(t)).ok, false, 'single use')
  assert.equal((await svc.checkInWithLink('made-up')).ok, false)
  void link
})

test('API token check-in', async () => {
  const tok = await svc.createApiToken(uid, 'laptop')
  assert.match(tok, /^bf_/)
  assert.ok(!JSON.stringify(await db.apiToken.findMany()).includes(tok), 'only the hash is stored')
  await setSw({ lastCheckinAt: ago(10 * DAY) })
  assert.equal(await svc.checkInWithApiToken(tok), uid)
  assert.ok(Date.now() - (await sw()).lastCheckinAt!.getTime() < 5000)
  assert.equal(await svc.checkInWithApiToken('bf_wrong'), null)
  const id = (await db.apiToken.findFirstOrThrow({ where: { userId: uid } })).id
  await svc.revokeApiToken(uid, id)
  assert.equal(await svc.checkInWithApiToken(tok), null, 'revoked token stops working')
})

test('alert channels: private addresses refused; webhook signed with HMAC', async () => {
  await assert.rejects(svc.setChannels(uid, [{ url: 'https://127.0.0.1/hook' }]), /public/)
  await assert.rejects(svc.setChannels(uid, [{ url: 'https://localhost/hook' }]), /public/)
  await assert.rejects(svc.setChannels(uid, [{ url: 'http://example.com/hook' }]), /https/)
  await assert.rejects(svc.setChannels(uid, [{ url: 'https://169.254.169.254/latest/meta-data' }]), /public/, 'cloud metadata blocked')
  // A local receiver, allowed only because this test opts in to private webhooks.
  const got: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = []
  const server = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.end('ok') }) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  process.env.ALLOW_PRIVATE_WEBHOOKS = 'true'
  try {
    await svc.setChannels(uid, [{ label: 'home', url: `http://127.0.0.1:${port}/busfactor` }])
    const raw = await sw()
    assert.ok(raw.alertChannels && !raw.alertChannels.includes('127.0.0.1'), 'channel URLs encrypted at rest')
    const res = await svc.testChannels(uid)
    assert.ok(res[0].ok, res[0].error)
    const st = await svc.getStatus(uid)
    const sig = createHmac('sha256', st.channelSecret!).update(`${got[0].headers['x-busfactor-timestamp']}.${got[0].body}`).digest('hex')
    assert.equal(got[0].headers['x-busfactor-signature'], `sha256=${sig}`)
    assert.equal(JSON.parse(got[0].body).event, 'TEST')
    // Stage events reach the channel too
    got.length = 0
    await setSw({ lastCheckinAt: ago(14 * DAY), stage: 'ACTIVE' }); await svc.tickUser(uid)
    assert.equal(JSON.parse(got[0].body).event, 'REMINDER_1')
    assert.ok(!got[0].body.includes('/c?t='), 'no one-click check-in links in channel alerts')
    await svc.checkIn(uid)
    await svc.setChannels(uid, [])
  } finally {
    delete process.env.ALLOW_PRIVATE_WEBHOOKS
    server.close()
  }
})

test('privacy: no names or email addresses in the database in readable form', async () => {
  const dump = JSON.stringify(await Promise.all([db.user.findMany(), db.nominee.findMany(), db.event.findMany(), db.switch.findMany(), db.message.findMany()]))
  for (const needle of ['alex@example.com', 'sam@example.com', 'pat@example.com', 'jo@example.com', 'Alex', 'Sam', '"Pat', 'Bea', 'the usual one', 'The name of our first dog']) {
    assert.ok(!dump.includes(needle), `found "${needle}" in the database`)
  }
})

test('scheduler health is recorded', async () => {
  await svc.tickAll()
  const st = await svc.getStatus(uid)
  assert.equal(st.scheduler.healthy, true)
})

test('review fix: switching off during an alert cancels it; contacts cannot act while off; re-enabling never sends the handover', async () => {
  await toAlert()
  const la = lastLink(A, '/n/respond'), lb = lastLink(B, '/n/respond')
  await svc.updateSettings(uid, { enabled: false })
  assert.equal((await sw()).stage, 'ACTIVE', 'alert cancelled')
  assert.equal((await svc.respond(la, 'NOT_OK')).ok, false, 'old links dead')
  assert.equal((await svc.respond(lb, 'NOT_OK')).ok, false)
  clear(); await svc.updateSettings(uid, { enabled: true }); await svc.tickUser(uid)
  assert.equal((await sw()).stage, 'ACTIVE'); assert.equal(to(T).length, 0, 'no handover')
})

test('review fix: after the handover is sent, only the owner can cancel it', async () => {
  await toAlert()
  await svc.respond(lastLink(A, '/n/respond'), 'NOT_OK')
  const lb = lastLink(B, '/n/respond')
  await setSw({ stageChangedAt: ago(72 * H) }); await svc.tickUser(uid)
  await setSw({ nomineeReminderSentAt: ago(24 * H) }); await svc.tickUser(uid)
  await setSw({ holdEndsAt: ago(1000) }); await svc.tickUser(uid)
  assert.equal((await sw()).stage, 'HANDOVER_SENT')
  const r = await svc.respond(lastLink(B, '/n/respond') || lb, 'OK')
  assert.equal(r.ok, false); assert.match(r.message, /Only Alex/)
  assert.equal((await sw()).stage, 'HANDOVER_SENT')
  await svc.checkIn(uid)
  assert.equal((await sw()).stage, 'ACTIVE')
})

test('review fix: owner is emailed about changes that could weaken the switch', async () => {
  clear()
  await svc.setInstructions(uid, { mode: 'SEALED', sealed: await sealText('x', 'passphrase words') })
  const id = await svc.addNominee(uid, { name: 'Kim', email: 'kim@example.com', role: 'CONFIRMER' })
  await svc.removeNominee(uid, id)
  await svc.updateSettings(uid, { enabled: false })
  const subjects = to(OWNER).map(m => m.subject)
  assert.equal(subjects.filter(s => /a change was made/.test(s)).length, 4, subjects.join(' | '))
  assert.ok(to(OWNER).some(m => /turned OFF/.test(m.html)))
  await svc.updateSettings(uid, { enabled: true })
})

test('removing the only trusted person from a switched-on switch warns the owner straight away', async () => {
  await svc.checkIn(uid)
  assert.equal((await sw()).enabled, true)
  clear(); await svc.removeNominee(uid, (await nomineeBy(T)).id)
  const warn = to(OWNER).find(m => /cannot hand over/.test(m.subject))
  assert.ok(warn, 'warning sent'); assert.match(warn.html, /no trusted person/)
  const st = await svc.getStatus(uid)
  assert.equal(st.coverage.ok, false)
})

test('one person can be both confirmer and handover person, with a single invitation', async () => {
  const w = await newUser('Wes', 'wes@example.com', {})
  clear(); await svc.addNominee(w.id, { name: 'Viv', email: 'viv@example.com', role: 'BOTH' })
  assert.equal(to('viv@example.com').length, 1, 'one email, not two')
  const inv = linkIn(to('viv@example.com')[0], '/n/invite')
  const look = await svc.lookupInvite(inv)
  assert.ok(look.valid && look.role === 'TRUSTED' && look.alsoConfirmer)
  assert.equal((await svc.getStatus(w.id)).coverage.ok, false, 'nothing counts until accepted')
  await svc.answerInvite(inv, true, await createRecipientKeys('viv passphrase words'))
  const c = await svc.coverage(w.id)
  assert.deepEqual([c.confirmers, c.trusted, c.ok], [1, 1, true])
  await svc.updateSettings(w.id, { enabled: true })
  await assert.rejects(svc.addNominee(w.id, { name: 'Viv', email: 'viv@example.com', role: 'CONFIRMER' }), /already on your list/)
})
