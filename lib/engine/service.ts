/**
 * busfactor switch service: everything that touches the database or sends email.
 *
 * Safety rules:
 *  - Every stage change is a guarded updateMany (where stage = expected), so an email
 *    can never be sent twice even if two ticks overlap.
 *  - Only nominees who have ACCEPTED their invitation are ever contacted.
 *  - Nominee links are single-use, hashed, scoped to one alert cycle, and revoked on reset.
 *  - The trusted person gets a link (not the secret) so a false alarm can revoke it.
 *  - Names and emails are encrypted at rest; this file decrypts them only when needed.
 */
import { randomBytes } from 'crypto'
import { db } from '../db'
import { appUrl, LIMITS } from '../config'
import { decPii, decPiiOpt, decryptText, emailHash, encPii, encPiiOpt, encryptText, hashToken, newToken, serverInstructionsAllowed } from '../crypto'
import { Emails } from '../emails'
import { sendMail } from '../mail'
import { isPublicKeyJwk, isRecipientBox, isSealedBox, keyFingerprint } from '../sealed'
import { sendToChannel, validateChannelUrl, channelKind, type AlertEvent, type Channel } from '../channels'
import { recordTick, schedulerHealthy } from '../system'
import { findPushDevice, listPushDevices, pushToUser, savePushDevice, vapidKeys, type PushMessage } from '../push'
import { UserError } from '../errors'
import { rateLimit } from '../auth'
import { clockStart, daysSince, decide, isPaused, othersContacted, type HoldReason, type Stage } from './stages'

export { UserError }

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const LINK_TTL_MS = 30 * DAY
const INVITE_TTL_MS = 30 * DAY
const CHECKIN_LINK_TTL_MS = 30 * DAY
const MAX_CHANNELS = 3

const loginUrl = () => `${appUrl()}/login?next=/dashboard`

// ---------------------------------------------------------------- helpers

export async function logEvent(userId: string, type: string, detail?: string) {
  try {
    await db.event.create({ data: { userId, type, detailEnc: encPiiOpt(detail) } })
  } catch (e) {
    console.error('[busfactor] failed to log event', type, e)
  }
}

async function send(userId: string, to: string, mail: { subject: string; html: string }, context: string) {
  const res = await sendMail({ to, ...mail })
  if (!res.ok) await logEvent(userId, 'EMAIL_FAILED', `${context}: ${res.error ?? 'unknown error'}`)
  return res.ok
}

export async function getSwitch(userId: string) {
  return db.switch.upsert({ where: { userId }, update: {}, create: { userId } })
}

async function transition(userId: string, expected: Stage, data: Record<string, unknown>): Promise<boolean> {
  const res = await db.switch.updateMany({ where: { userId, stage: expected }, data: { ...data, stageChangedAt: new Date() } })
  return res.count === 1
}

type NomineeRow = Awaited<ReturnType<typeof db.nominee.findFirstOrThrow>>
function decNominee(n: NomineeRow) {
  return {
    id: n.id, userId: n.userId, role: n.role, status: n.status, invitedAt: n.invitedAt, acceptedAt: n.acceptedAt, createdAt: n.createdAt,
    name: decPii(n.nameEnc), email: decPii(n.emailEnc), publicKey: n.publicKey, hasKey: !!n.publicKey,
  }
}
export type Nominee = ReturnType<typeof decNominee>

async function acceptedNominees(userId: string, role: 'CONFIRMER' | 'TRUSTED') {
  const rows = await db.nominee.findMany({ where: { userId, role, status: 'ACCEPTED' }, orderBy: { createdAt: 'asc' } })
  return rows.map(decNominee)
}

async function notOkCount(userId: string, cycleId: string | null): Promise<number> {
  if (!cycleId) return 0
  const rows = await db.responseToken.findMany({ where: { userId, cycleId, kind: 'RESPOND', response: 'NOT_OK' }, select: { nomineeId: true } })
  return new Set(rows.map(r => r.nomineeId)).size
}

/** Two "not OK" answers are needed by default, but never more than the number of confirmers. */
async function effectiveRequired(userId: string, required: number) {
  const n = await db.nominee.count({ where: { userId, role: 'CONFIRMER', status: 'ACCEPTED' } })
  return Math.max(1, Math.min(required, n || 1))
}

/**
 * The minimum for a switch that can actually do something: one accepted confirmer to ask,
 * and one accepted trusted person to receive the handover (they can be the same person).
 */
export async function coverage(userId: string) {
  const [confirmers, trusted] = await Promise.all([
    db.nominee.count({ where: { userId, role: 'CONFIRMER', status: 'ACCEPTED' } }),
    db.nominee.count({ where: { userId, role: 'TRUSTED', status: 'ACCEPTED' } }),
  ])
  const missing: string[] = []
  if (confirmers < 1) missing.push('no confirmer who has accepted (someone we can ask whether you are OK)')
  if (trusted < 1) missing.push('no trusted person who has accepted (someone to receive your handover)')
  return { confirmers, trusted, ok: missing.length === 0, missing }
}

/** Emails the owner when their switch is on but has nobody to ask or nobody to hand over to. */
async function warnIfUncovered(userId: string, onlyIfNotWarnedForMs = 0) {
  const s = await getSwitch(userId)
  if (!s.enabled) return
  const c = await coverage(userId)
  if (c.ok) return
  if (onlyIfNotWarnedForMs) {
    const recent = await db.event.findFirst({ where: { userId, type: 'NOT_COVERED', createdAt: { gt: new Date(Date.now() - onlyIfNotWarnedForMs) } } })
    if (recent) return
  }
  const u = await owner(userId)
  await send(userId, u.email, Emails.notCovered(u.name, c.missing, `${appUrl()}/login?next=${encodeURIComponent('/dashboard?s=people')}`), 'not covered warning')
  await logEvent(userId, 'NOT_COVERED', c.missing.join('; '))
}

export async function owner(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
  return { id: u.id, name: decPii(u.nameEnc), email: decPii(u.emailEnc), emailVerifiedAt: u.emailVerifiedAt }
}

/** A single-use link that checks the owner in (put in reminder emails). */
async function checkinUrl(userId: string) {
  const { token, hash } = newToken()
  await db.authToken.create({ data: { tokenHash: hash, userId, purpose: 'CHECKIN', expiresAt: new Date(Date.now() + CHECKIN_LINK_TTL_MS) } })
  return `${appUrl()}/c?t=${token}`
}

// ---------------------------------------------------------------- alert channels

async function readChannels(s: { alertChannels: string | null }): Promise<Channel[]> {
  if (!s.alertChannels) return []
  try { return JSON.parse(decPii(s.alertChannels)) as Channel[] } catch { return [] }
}

async function notifyChannels(userId: string, e: Omit<AlertEvent, 'at'>) {
  const s = await getSwitch(userId)
  const chans = await readChannels(s)
  if (!chans.length) return
  const secret = decPiiOpt(s.channelSecret)
  // In parallel, each with a hard 10-second deadline, so one slow endpoint cannot stall the scheduler.
  const errs = await Promise.all(chans.map(c => sendToChannel(c.url, { ...e, at: new Date().toISOString() }, secret)))
  for (const [i, err] of errs.entries()) if (err) await logEvent(userId, 'CHANNEL_FAILED', `${chans[i].label}: ${err}`)
}

/**
 * Sends a notification to the owner's phones and browsers. Returns how many devices got it.
 * A device the push service reports as gone is removed, and the owner is told by email, because a
 * reminder that silently stops arriving is exactly what must not happen.
 */
async function pushOwner(userId: string, msg: PushMessage): Promise<number> {
  try {
    const r = await pushToUser(userId, msg)
    if (r.removed.length) {
      const u = await owner(userId)
      for (const name of r.removed) {
        await logEvent(userId, 'PUSH_DEVICE_REMOVED', name)
        await send(userId, u.email, Emails.pushDeviceGone(u.name, name, `${appUrl()}/login?next=${encodeURIComponent('/dashboard?s=phone')}`), 'push device gone')
      }
    }
    return r.delivered
  } catch (e) {
    console.error('[busfactor] push failed', e)
    return 0
  }
}

/** A check-in link for a notification (separate from the email's, so using one does not spoil the other). */
async function phoneCheckinUrl(userId: string) {
  return `${await checkinUrl(userId)}&via=phone`
}

export async function addPushDevice(userId: string, subscription: unknown, name: unknown) {
  const r = await savePushDevice(userId, subscription, name)
  if (r.isNew) {
    await logEvent(userId, 'PUSH_DEVICE_ADDED', r.name)
    await securityNotice(userId, `"${r.name}" was added as a device that receives your check-in reminders.`)
  }
  return r
}

export async function removePushDevice(userId: string, id: string) {
  const row = await db.pushDevice.findFirst({ where: { id, userId } })
  if (!row) return
  await db.pushDevice.delete({ where: { id: row.id } })
  await logEvent(userId, 'PUSH_DEVICE_DELETED', decPii(row.nameEnc))
  await securityNotice(userId, `"${decPii(row.nameEnc)}" will no longer receive your check-in reminders.`)
}

export async function testPush(userId: string) {
  if (!(await rateLimit(`push-test:${userId}`, 10, HOUR))) throw new UserError('Please wait a little before sending another test.')
  const n = await pushOwner(userId, { title: 'busfactor test', body: 'Notifications are working. This is what your check-in reminders will look like.', url: `${appUrl()}/dashboard?s=phone`, tag: 'test' })
  await logEvent(userId, 'PUSH_TEST', `${n} device(s)`)
  return { delivered: n }
}

export { findPushDevice }

export async function setChannels(userId: string, list: Array<{ label?: string; url: string }>) {
  if (!Array.isArray(list) || list.length > MAX_CHANNELS) throw new UserError(`You can add up to ${MAX_CHANNELS} alert channels.`)
  const out: Channel[] = []
  for (const c of list) {
    let url: string
    try { url = await validateChannelUrl(String(c.url ?? '')) } catch (e) { throw new UserError((e as Error).message) }
    out.push({ id: randomBytes(6).toString('hex'), label: String(c.label || channelKind(url)).slice(0, 40), url })
  }
  const s = await getSwitch(userId)
  await db.switch.update({
    where: { userId },
    data: {
      alertChannels: out.length ? encPii(JSON.stringify(out)) : null,
      channelSecret: s.channelSecret ?? encPii(randomBytes(24).toString('hex')),
    },
  })
  await logEvent(userId, 'CHANNELS_UPDATED', out.map(c => c.label).join(', ') || 'none')
  await securityNotice(userId, `Your alert channels were changed (${out.map(c => `${c.label}: ${new URL(c.url).host}`).join(', ') || 'none'}).`)
}

export async function testChannels(userId: string) {
  if (!(await rateLimit(`channel-test:${userId}`, 5, HOUR))) throw new UserError('You can send 5 test alerts an hour.')
  const s = await getSwitch(userId)
  const chans = await readChannels(s)
  if (!chans.length) throw new UserError('Add a channel first.')
  const secret = decPiiOpt(s.channelSecret)
  const results: Array<{ label: string; ok: boolean; error?: string }> = []
  for (const c of chans) {
    const err = await sendToChannel(c.url, { event: 'TEST', title: 'busfactor test alert', message: 'If you can read this, busfactor can reach you here.', url: `${appUrl()}/dashboard`, at: new Date().toISOString() }, secret)
    results.push({ label: c.label, ok: !err, error: err ?? undefined })
  }
  return results
}

// ---------------------------------------------------------------- status

export async function getStatus(userId: string) {
  const s = await getSwitch(userId)
  const [u, userRow, nomineeRows, events, messages, passkeys, apiTokens, health] = await Promise.all([
    owner(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, emailOtpEnabled: true, recoveryCodes: true } }),
    db.nominee.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.event.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.message.findMany({ where: { userId }, select: { nomineeId: true, sizeBytes: true, updatedAt: true } }),
    db.passkey.findMany({ where: { userId }, select: { id: true, name: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'asc' } }),
    db.apiToken.findMany({ where: { userId }, select: { id: true, name: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'asc' } }),
    schedulerHealthy(),
  ])
  const now = new Date()
  const clock = { lastCheckinAt: s.lastCheckinAt, createdAt: s.createdAt, pausedUntil: s.pausedUntil, now }
  const start = clockStart(clock)
  const at = (d: number) => new Date(start.getTime() + d * DAY)
  const { instructions, alertChannels, channelSecret, sealedHint, ...safe } = s
  const msgBy = new Map(messages.map(m => [m.nomineeId, m]))
  const channels = await readChannels({ alertChannels })
  return {
    user: { name: u.name, email: u.email, verified: !!u.emailVerifiedAt },
    settings: { ...safe, sealedHint: decPiiOpt(sealedHint) },
    hasInstructions: !!instructions,
    serverInstructionsAllowed: serverInstructionsAllowed(),
    paused: isPaused({ pausedUntil: s.pausedUntil, now }),
    daysSinceCheckin: daysSince(clock),
    scheduler: health,
    schedule: {
      reminder1At: at(s.reminder1AfterDays),
      reminder2At: at(s.reminder2AfterDays),
      nomineeAlertAt: at(s.nomineeAlertAfterDays),
      nomineeReminderAt: s.stage === 'NOMINEES_ALERTED' && !s.nomineeReminderSentAt ? new Date(s.stageChangedAt.getTime() + s.nomineeReminderHours * HOUR) : null,
      goAheadAt: s.stage === 'NOMINEES_ALERTED' && s.nomineeReminderSentAt ? new Date(s.nomineeReminderSentAt.getTime() + s.nomineeFinalHours * HOUR) : null,
    },
    notOkCount: await notOkCount(userId, s.alertCycleId),
    coverage: await coverage(userId),
    push: { publicKey: (await vapidKeys()).publicKey, devices: await listPushDevices(userId) },
    nominees: nomineeRows.map(decNominee).map(n => ({ ...n, message: msgBy.get(n.id) ?? null })),
    channels: channels.map(c => ({ id: c.id, label: c.label, kind: channelKind(c.url), host: new URL(c.url).host })),
    channelSecret: channels.length ? decPiiOpt(channelSecret) : null,
    security: {
      totp: !!userRow.totpEnabledAt,
      emailOtp: userRow.emailOtpEnabled,
      passkeys,
      recoveryCodesLeft: userRow.recoveryCodes ? (JSON.parse(userRow.recoveryCodes) as string[]).length : 0,
    },
    apiTokens,
    events: events.map(e => ({ id: e.id, type: e.type, createdAt: e.createdAt, detail: safeDec(e.detailEnc) })),
  }
}

function safeDec(v: string | null) {
  try { return decPiiOpt(v) } catch { return null }
}

// ---------------------------------------------------------------- settings

export interface SettingsInput {
  enabled?: boolean
  reminder1AfterDays?: number
  reminder2AfterDays?: number
  nomineeAlertAfterDays?: number
  requiredConfirmations?: number
  nomineeReminderHours?: number
  nomineeFinalHours?: number
  holdHours?: number
  pausedUntil?: string | null
  reminder1Email?: boolean
}

/** Tells the owner by email whenever something that could weaken their switch changes. */
export async function securityNotice(userId: string, what: string) {
  const u = await owner(userId)
  await send(userId, u.email, Emails.accountChanged(u.name, what, `${appUrl()}/login?next=/dashboard`), 'change notice')
}

const intIn = (v: number, lo: number, hi: number, msg: string) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new UserError(msg)
  return v
}

export async function updateSettings(userId: string, input: SettingsInput) {
  const s = await getSwitch(userId)
  const r1 = intIn(input.reminder1AfterDays ?? s.reminder1AfterDays, 1, 365, 'First reminder must be 1–365 days.')
  const r2 = intIn(input.reminder2AfterDays ?? s.reminder2AfterDays, 2, 366, 'Second reminder must be 2–366 days.')
  const na = intIn(input.nomineeAlertAfterDays ?? s.nomineeAlertAfterDays, 3, 367, 'Contacting nominees must be 3–367 days.')
  if (!(r2 > r1 && na > r2)) throw new UserError('Days must increase: first reminder, then second reminder, then contacts.')
  const data = {
    reminder1AfterDays: r1, reminder2AfterDays: r2, nomineeAlertAfterDays: na,
    requiredConfirmations: intIn(input.requiredConfirmations ?? s.requiredConfirmations, 1, 5, '"Not OK" answers needed must be 1–5.'),
    nomineeReminderHours: intIn(input.nomineeReminderHours ?? s.nomineeReminderHours, 1, 720, 'Reminder to contacts must be 1–720 hours.'),
    nomineeFinalHours: intIn(input.nomineeFinalHours ?? s.nomineeFinalHours, 1, 720, 'Final wait must be 1–720 hours.'),
    holdHours: intIn(input.holdHours ?? s.holdHours, 0, 720, 'Hold must be 0–720 hours.'),
  } as Record<string, unknown>
  if (typeof input.reminder1Email === 'boolean') data.reminder1Email = input.reminder1Email

  if (input.pausedUntil !== undefined) {
    if (input.pausedUntil === null || input.pausedUntil === '') data.pausedUntil = null
    else {
      const d = new Date(input.pausedUntil)
      if (isNaN(d.getTime())) throw new UserError('Pause date is not valid.')
      if (d.getTime() > Date.now() + 90 * DAY) throw new UserError('You can pause for at most 90 days.')
      data.pausedUntil = d
    }
  }
  if (input.enabled !== undefined && input.enabled !== s.enabled) {
    if (input.enabled) {
      const u = await owner(userId)
      if (!u.emailVerifiedAt) throw new UserError('Please confirm your email address before switching on.')
      const c = await coverage(userId)
      if (!c.ok) {
        throw new UserError(c.confirmers < 1 && c.trusted < 1
          ? 'Before switching on, you need at least one confirmer and one trusted person who have accepted their invitations (they can be the same person).'
          : c.confirmers < 1
            ? 'Before switching on, you need at least one confirmer who has accepted: someone we can ask whether you are OK.'
            : 'Before switching on, you need a trusted person who has accepted: someone to receive your handover.')
      }
      data.lastCheckinAt = new Date() // switching on starts the clock now
    }
    data.enabled = input.enabled
  }
  const changed = Object.keys(data).filter(k => String((s as Record<string, unknown>)[k]) !== String(data[k]))
  await db.switch.update({ where: { userId }, data })
  if (changed.length) {
    await logEvent(userId, 'SETTINGS_UPDATED', changed.join(', '))
    const off = changed.includes('enabled') && data.enabled === false
    const paused = changed.includes('pausedUntil') && data.pausedUntil
    await securityNotice(userId, off ? 'Your switch was turned OFF.' : paused ? `Your switch was paused until ${(data.pausedUntil as Date).toUTCString()}.` : `Settings changed: ${changed.join(', ')}.`)
    // Turning it off or pausing it means the owner is here: cancel any alert in progress (and revoke its links).
    if ((changed.includes('enabled') || paused) && s.stage !== 'ACTIVE') await checkIn(userId, off ? 'switch turned off' : 'paused')
  }
  return getStatus(userId)
}

export async function setInstructions(userId: string, input: { mode: 'NONE' | 'SERVER' | 'SEALED'; text?: string; sealed?: string; hint?: string }) {
  let instructions: string | null = null
  if (input.mode === 'SERVER') {
    if (!serverInstructionsAllowed()) throw new UserError('This site does not store readable instructions. Please use a passphrase (sealed).')
    const text = (input.text ?? '').trim()
    if (!text) throw new UserError('Please write your instructions.')
    if (text.length > LIMITS.maxInstructionsChars) throw new UserError(`Instructions are limited to ${LIMITS.maxInstructionsChars} characters.`)
    instructions = encryptText(text)
  } else if (input.mode === 'SEALED') {
    if (!input.sealed || !isSealedBox(input.sealed)) throw new UserError('Sealed instructions are missing or damaged. Please try again.')
    instructions = input.sealed
  }
  const hint = input.mode === 'SEALED' ? (input.hint ?? '').trim().slice(0, 200) || null : null
  await db.switch.update({ where: { userId }, data: { instructionsMode: input.mode, instructions, sealedHint: encPiiOpt(hint) } })
  await logEvent(userId, 'INSTRUCTIONS_UPDATED', input.mode)
  await securityNotice(userId, input.mode === 'NONE' ? 'Your handover instructions were removed.' : 'Your handover instructions were replaced.')
}

// ---------------------------------------------------------------- personal messages

export async function setMessage(userId: string, nomineeId: string, box: string, sizeBytes: number) {
  const n = await db.nominee.findFirst({ where: { id: nomineeId, userId } })
  if (!n || n.role !== 'TRUSTED') throw new UserError('Personal messages are for the people who receive your handover.')
  if (!n.publicKey) throw new UserError('They have not set up their passphrase yet.')
  if (!isRecipientBox(box, LIMITS.maxMessageBoxChars)) throw new UserError('The message is damaged or too large. Please try again.')
  const size = Math.max(0, Math.min(Number(sizeBytes) || 0, LIMITS.maxMessageBytes * 2))
  await db.message.upsert({ where: { nomineeId }, update: { box, sizeBytes: size }, create: { userId, nomineeId, box, sizeBytes: size } })
  await logEvent(userId, 'MESSAGE_SAVED', decPii(n.nameEnc))
  await securityNotice(userId, `Your personal message for ${decPii(n.nameEnc)} was saved.`)
}

export async function deleteMessage(userId: string, nomineeId: string) {
  const res = await db.message.deleteMany({ where: { userId, nomineeId } })
  if (res.count) { await logEvent(userId, 'MESSAGE_DELETED', nomineeId); await securityNotice(userId, 'A personal message was deleted.') }
}

// ---------------------------------------------------------------- nominees

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function addNominee(userId: string, input: { name: string; email: string; role: string }) {
  const name = (input.name ?? '').trim().slice(0, 100)
  const email = (input.email ?? '').trim().toLowerCase()
  const role = input.role === 'TRUSTED' ? 'TRUSTED' : input.role === 'CONFIRMER' ? 'CONFIRMER' : input.role === 'BOTH' ? 'BOTH' : null
  if (!name) throw new UserError('Please give the contact a name.')
  if (!EMAIL_RE.test(email) || email.length > 190) throw new UserError('Please give a valid email address.')
  if (!role) throw new UserError('Choose whether this person confirms, or receives the handover.')
  const u = await owner(userId)
  if (!u.emailVerifiedAt) throw new UserError('Please confirm your own email address first.')
  const eh = emailHash(email)
  if (eh === emailHash(u.email)) throw new UserError('Your contacts must be other people.')
  const roles = role === 'BOTH' ? (['CONFIRMER', 'TRUSTED'] as const) : ([role] as const)
  if ((await db.nominee.count({ where: { userId } })) + roles.length > LIMITS.maxNominees) throw new UserError(`You can have up to ${LIMITS.maxNominees} contacts.`)
  if (await db.nominee.findFirst({ where: { userId, emailHash: eh, role: { in: [...roles] } } })) throw new UserError('That person is already on your list for that role.')

  const { token, hash } = newToken()
  const now = new Date()
  // For "both", one invitation (the handover one, which sets up their passphrase) answers both roles:
  // the confirmer row has no link of its own and follows the handover row's answer.
  if (role === 'BOTH') {
    await db.nominee.create({ data: { userId, nameEnc: encPii(name), emailEnc: encPii(email), emailHash: eh, role: 'CONFIRMER', invitedAt: now } })
  }
  const n = await db.nominee.create({ data: { userId, nameEnc: encPii(name), emailEnc: encPii(email), emailHash: eh, role: role === 'BOTH' ? 'TRUSTED' : role, inviteTokenHash: hash, invitedAt: now } })
  await send(userId, email, Emails.invite(u.name, name, role, `${appUrl()}/n/invite?t=${token}`), 'invite')
  const label = role === 'BOTH' ? 'confirmer and handover' : role === 'TRUSTED' ? 'handover' : 'confirmer'
  await logEvent(userId, 'NOMINEE_INVITED', `${name} (${label})`)
  await securityNotice(userId, `${name} (${email}) was invited as ${role === 'BOTH' ? 'a confirmer and the person who receives your handover' : role === 'TRUSTED' ? 'the person who receives your handover' : 'a confirmer'}.`)
  return n.id
}

/** Resends an invitation, or, for an accepted trusted person without a key, asks them to set up their passphrase. */
export async function resendInvite(userId: string, nomineeId: string) {
  const row = await db.nominee.findFirst({ where: { id: nomineeId, userId } })
  if (!row) throw new UserError('Contact not found.')
  const n = decNominee(row)
  if (n.status === 'ACCEPTED' && !(n.role === 'TRUSTED' && !n.hasKey)) throw new UserError('They have already accepted.')
  if (row.invitedAt && Date.now() - row.invitedAt.getTime() < HOUR) throw new UserError('Please wait an hour before sending it again.')
  const u = await owner(userId)
  const { token, hash } = newToken()
  await db.nominee.update({ where: { id: n.id }, data: { inviteTokenHash: hash, invitedAt: new Date(), status: n.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING' } })
  await send(userId, n.email, Emails.invite(u.name, n.name, n.role, `${appUrl()}/n/invite?t=${token}`), 'invite (resend)')
  await logEvent(userId, 'NOMINEE_INVITED', `${n.name} (resent)`)
}

export async function removeNominee(userId: string, nomineeId: string) {
  const s = await getSwitch(userId)
  if (s.stage !== 'ACTIVE' && s.stage !== 'REMINDER_1' && s.stage !== 'REMINDER_2') {
    throw new UserError('Your contacts have already been alerted. Check in first, then change your contacts.')
  }
  const row = await db.nominee.findFirst({ where: { id: nomineeId, userId } })
  if (!row) return
  await db.nominee.delete({ where: { id: row.id } })
  await logEvent(userId, 'NOMINEE_REMOVED', decPii(row.nameEnc))
  await securityNotice(userId, `${decPii(row.nameEnc)} was removed from your contacts.`)
  await warnIfUncovered(userId)
}

async function findInvite(token: string) {
  const n = await db.nominee.findUnique({ where: { inviteTokenHash: hashToken(token ?? '') } })
  if (!n || !n.invitedAt || Date.now() - n.invitedAt.getTime() > INVITE_TTL_MS) return null
  return n
}

export async function lookupInvite(token: string) {
  const row = await findInvite(token)
  if (!row) return { valid: false as const, reason: 'This invitation link is not valid or has expired.' }
  const n = decNominee(row)
  const u = await owner(row.userId)
  const alsoConfirmer = n.role === 'TRUSTED' && n.status !== 'ACCEPTED'
    && !!(await db.nominee.findFirst({ where: { userId: row.userId, emailHash: row.emailHash, role: 'CONFIRMER', status: 'PENDING', inviteTokenHash: null } }))
  return { valid: true as const, ownerName: u.name, nomineeName: n.name, role: n.role, status: n.status, needsKey: n.role === 'TRUSTED' && !n.hasKey, alsoConfirmer }
}

export async function answerInvite(token: string, accept: boolean, keys?: { publicKey?: string; encPrivateKey?: string; hint?: string }) {
  const row = await findInvite(token)
  if (!row) return { ok: false, message: 'This invitation link is not valid or has expired.' }
  const n = decNominee(row)
  const u = await owner(row.userId)
  const data: Record<string, unknown> = { inviteTokenHash: null }
  if (accept && n.role === 'TRUSTED') {
    if (!keys?.publicKey || !isPublicKeyJwk(keys.publicKey) || !keys.encPrivateKey || !isSealedBox(keys.encPrivateKey, 10_000)) {
      return { ok: false, message: 'Please choose a passphrase first.' }
    }
    Object.assign(data, { publicKey: keys.publicKey, encPrivateKey: keys.encPrivateKey, keyHintEnc: encPiiOpt((keys.hint ?? '').trim().slice(0, 200) || null), keyCreatedAt: new Date() })
    if (row.publicKey && row.publicKey !== keys.publicKey) {
      await securityNotice(row.userId, `${n.name} set up a new key. New fingerprint: ${await keyFingerprint(keys.publicKey)}. If you did not expect this, check with them by phone.`)
      // Old personal message was locked to the old key: remove it and ask the owner to write it again.
      const removed = await db.message.deleteMany({ where: { nomineeId: row.id } })
      if (removed.count) await send(row.userId, u.email, Emails.messageNeedsResave(n.name), 'message re-save')
    }
  }
  const wasAccepted = n.status === 'ACCEPTED'
  Object.assign(data, { status: accept ? 'ACCEPTED' : 'DECLINED', acceptedAt: accept ? (row.acceptedAt ?? new Date()) : null })
  if (!accept) Object.assign(data, { publicKey: null, encPrivateKey: null, keyHintEnc: null, keyCreatedAt: null })
  await db.nominee.update({ where: { id: row.id }, data })
  if (row.role === 'TRUSTED' && !wasAccepted) {
    // Invited as both: the linked confirmer row (no link of its own) takes the same answer.
    await db.nominee.updateMany({
      where: { userId: row.userId, emailHash: row.emailHash, role: 'CONFIRMER', status: 'PENDING', inviteTokenHash: null },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED', acceptedAt: accept ? new Date() : null },
    })
  }
  await logEvent(row.userId, accept ? (wasAccepted ? 'NOMINEE_KEY_SET' : 'NOMINEE_ACCEPTED') : 'NOMINEE_DECLINED', n.name)
  if (!wasAccepted) await send(row.userId, u.email, Emails.inviteAnsweredOwner(n.name, accept), 'invite answered')
  if (!accept && wasAccepted) await warnIfUncovered(row.userId)
  return {
    ok: true,
    message: accept
      ? `Thank you. You will only hear from us if ${u.name} stops checking in.${n.role === 'TRUSTED' ? ' Keep your passphrase somewhere safe: you will need it.' : ''}`
      : `Thank you. ${u.name} has been told, and you will not be contacted.`,
  }
}

// ---------------------------------------------------------------- check-in / reset

async function resetToActive(userId: string) {
  const s = await getSwitch(userId)
  const prev = s.stage as Stage
  await db.switch.update({
    where: { userId },
    data: {
      stage: 'ACTIVE', stageChangedAt: new Date(), lastCheckinAt: new Date(),
      alertCycleId: null, holdEndsAt: null, holdReason: null, nomineeReminderSentAt: null,
    },
  })
  if (s.alertCycleId) {
    await db.responseToken.updateMany({ where: { userId, cycleId: s.alertCycleId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
  return prev
}

export async function checkIn(userId: string, source = 'dashboard') {
  const prev = await resetToActive(userId)
  await logEvent(userId, 'CHECK_IN', source)
  const u = await owner(userId)
  await notifyAllClear(userId, u.name, `${u.name} themselves`, prev)
  return { prev }
}

/** One-click check-in from a reminder email (after a button press on the page it opens). */
export async function checkInWithLink(token: string, source = 'email link') {
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token ?? '') } })
  if (!row || row.purpose !== 'CHECKIN' || row.usedAt || row.expiresAt < new Date()) return { ok: false }
  const upd = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  if (upd.count !== 1) return { ok: false }
  await checkIn(row.userId, source)
  return { ok: true, name: (await owner(row.userId)).name }
}

async function notifyAllClear(userId: string, ownerName: string, whoConfirmed: string, prev: Stage, skipNomineeId?: string) {
  if (!othersContacted(prev)) return
  const recipients = [...(await acceptedNominees(userId, 'CONFIRMER'))]
  // The trusted person only hears about it if they were actually sent the handover.
  if (prev === 'HANDOVER_SENT') recipients.push(...(await acceptedNominees(userId, 'TRUSTED')))
  const seen = new Set<string>()
  for (const n of recipients) {
    if (n.id === skipNomineeId || seen.has(n.email)) continue
    seen.add(n.email)
    await send(userId, n.email, Emails.falseAlarm(n.name, ownerName, whoConfirmed), 'all clear')
  }
  await logEvent(userId, 'ALL_CLEAR_SENT', `confirmed by ${whoConfirmed}`)
  await notifyChannels(userId, { event: 'ALL_CLEAR', title: 'All clear', message: `${whoConfirmed} confirmed you are OK. Everything has been reset.`, url: `${appUrl()}/dashboard` })
}

// ---------------------------------------------------------------- API tokens (CLI check-in)

export async function createApiToken(userId: string, name: string) {
  const label = (name ?? '').trim().slice(0, 100) || 'CLI'
  if ((await db.apiToken.count({ where: { userId } })) >= 5) throw new UserError('You can have up to 5 check-in tokens.')
  const { token, hash } = newToken('bf_')
  await db.apiToken.create({ data: { userId, name: label, tokenHash: hash } })
  await logEvent(userId, 'API_TOKEN_CREATED', label)
  await securityNotice(userId, `A check-in token "${label}" was created.`)
  return token
}

export async function revokeApiToken(userId: string, id: string) {
  const res = await db.apiToken.deleteMany({ where: { id, userId } })
  if (res.count) await logEvent(userId, 'API_TOKEN_REVOKED', id)
}

export async function checkInWithApiToken(token: string) {
  if (!token?.startsWith('bf_')) return null
  const row = await db.apiToken.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row) return null
  await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
  await checkIn(row.userId, `API token "${row.name}"`)
  return row.userId
}

// ---------------------------------------------------------------- nominee answers

async function findLink(token: string, kind: 'RESPOND' | 'HANDOVER') {
  const row = await db.responseToken.findUnique({ where: { tokenHash: hashToken(token ?? '') } })
  if (!row || row.kind !== kind) return { row: null, reason: 'This link is not valid.' }
  const ownerName = (await owner(row.userId)).name
  if (row.revokedAt) return { row: null, reason: `This link is no longer active. ${ownerName} has been confirmed OK, so no action is needed.` }
  if (row.expiresAt < new Date()) return { row: null, reason: 'This link has expired.' }
  const s = await getSwitch(row.userId)
  if (row.cycleId !== s.alertCycleId) return { row: null, reason: 'This link is no longer active. No action is needed.' }
  const nominee = decNominee(await db.nominee.findUniqueOrThrow({ where: { id: row.nomineeId } }))
  return { row, nominee, ownerName, reason: '' }
}

export async function lookupRespond(token: string) {
  const { row, nominee, ownerName, reason } = await findLink(token, 'RESPOND')
  if (!row) return { valid: false as const, reason }
  if (row.respondedAt) return { valid: false as const, reason: 'Thank you, your answer has already been recorded.' }
  return { valid: true as const, nomineeName: nominee!.name, ownerName: ownerName! }
}

export async function respond(token: string, answer: 'OK' | 'NOT_OK') {
  const { row, nominee, ownerName, reason } = await findLink(token, 'RESPOND')
  if (!row) return { ok: false, message: reason }
  const sw = await getSwitch(row.userId)
  if (!sw.enabled) return { ok: false, message: `${ownerName} has switched this off, so no action is needed.` }
  if (sw.stage === 'HANDOVER_SENT') return { ok: false, message: `The handover has already been sent. Only ${ownerName} can cancel it now, by logging in.` }
  const upd = await db.responseToken.updateMany({ where: { id: row.id, respondedAt: null, revokedAt: null }, data: { response: answer, respondedAt: new Date() } })
  if (upd.count !== 1) return { ok: false, message: 'Your answer has already been recorded.' }
  const name = nominee!.name
  await logEvent(row.userId, answer === 'OK' ? 'NOMINEE_SAYS_OK' : 'NOMINEE_SAYS_NOT_OK', name)

  if (answer === 'OK') {
    const prev = await resetToActive(row.userId)
    const u = await owner(row.userId)
    await send(row.userId, u.email, Emails.okConfirmedOwner(name), 'ok confirmed')
    await notifyAllClear(row.userId, u.name, name, prev, row.nomineeId)
    return { ok: true, message: `Thank you. Everything has been reset, and the others have been told ${ownerName} is OK.` }
  }
  await maybeStartHold(row.userId, 'CONFIRMED')
  if ((await getSwitch(row.userId)).stage !== 'NOMINEES_ALERTED') {
    return { ok: true, message: `Thank you. That confirms it, so a safety wait has started before ${ownerName}'s instructions are sent. You do not need to do anything else.` }
  }
  return { ok: true, message: 'Thank you, your answer has been recorded. If the others do not reply they will be reminded; if they still do not reply, your answer will be trusted.' }
}

export async function lookupHandover(token: string) {
  const { row, nominee, ownerName, reason } = await findLink(token, 'HANDOVER')
  if (!row) return { valid: false as const, reason }
  const s = await getSwitch(row.userId)
  const hasPersonal = !!(await db.message.findUnique({ where: { nomineeId: row.nomineeId }, select: { id: true } }))
  return { valid: true as const, ownerName: ownerName!, trustedName: nominee!.name, mode: s.instructionsMode, hasPersonal }
}

/** Called by an explicit button press (POST), never on page load, so link scanners cannot open it. */
export async function openHandover(token: string) {
  const { row, nominee, reason } = await findLink(token, 'HANDOVER')
  if (!row) return { ok: false as const, message: reason }
  const s = await getSwitch(row.userId)
  if (!row.respondedAt) {
    await db.responseToken.update({ where: { id: row.id }, data: { response: 'VIEWED', respondedAt: new Date() } })
    await logEvent(row.userId, 'HANDOVER_VIEWED', nominee!.name)
  }
  const nomRow = await db.nominee.findUniqueOrThrow({ where: { id: row.nomineeId } })
  const msg = await db.message.findUnique({ where: { nomineeId: row.nomineeId } })
  const personal = msg && nomRow.encPrivateKey ? { box: msg.box, encPrivateKey: nomRow.encPrivateKey, hint: decPiiOpt(nomRow.keyHintEnc) } : null

  let general: { mode: 'SERVER'; text: string } | { mode: 'SEALED'; sealed: string; hint: string | null } | { mode: 'NONE' } = { mode: 'NONE' }
  if (s.instructionsMode === 'SERVER' && s.instructions) {
    try { general = { mode: 'SERVER', text: decryptText(s.instructions) } } catch (e) {
      await logEvent(row.userId, 'DECRYPT_FAILED', String(e))
    }
  } else if (s.instructionsMode === 'SEALED' && s.instructions) {
    general = { mode: 'SEALED', sealed: s.instructions, hint: decPiiOpt(s.sealedHint) }
  }
  return { ok: true as const, general, personal }
}

async function maybeStartHold(userId: string, reason: HoldReason) {
  const s = await getSwitch(userId)
  if (s.stage !== 'NOMINEES_ALERTED') return
  if (reason === 'CONFIRMED' && (await notOkCount(userId, s.alertCycleId)) < (await effectiveRequired(userId, s.requiredConfirmations))) return
  const holdEndsAt = new Date(Date.now() + s.holdHours * HOUR)
  if (!(await transition(userId, 'NOMINEES_ALERTED', { stage: 'HOLD', holdEndsAt, holdReason: reason }))) return
  await logEvent(userId, 'HOLD_STARTED', `${reason}; handover at ${holdEndsAt.toISOString()}`)
  const u = await owner(userId)
  const trusted = await acceptedNominees(userId, 'TRUSTED')
  const cUrl = await checkinUrl(userId)
  await send(userId, u.email, Emails.holdStartedOwner(u.name, holdEndsAt, trusted.map(t => t.name), cUrl, reason), 'hold started (owner)')
  for (const n of await acceptedNominees(userId, 'CONFIRMER')) {
    await send(userId, n.email, Emails.holdStartedNominee(n.name, u.name, holdEndsAt, reason), 'hold started (contact)')
  }
  await notifyChannels(userId, { event: 'HOLD_STARTED', title: 'Handover has started', message: `Your handover will be sent ${holdEndsAt.toUTCString()} unless you check in.`, url: loginUrl() })
  await pushOwner(userId, { title: 'Your handover has started', body: 'It will be sent unless you check in. Tap to cancel it.', url: await phoneCheckinUrl(userId), tag: 'checkin', urgent: true })
  if (s.holdHours === 0) await tickUser(userId)
}

// ---------------------------------------------------------------- scheduled tick

export async function tickUser(userId: string, now = new Date()) {
  const s = await getSwitch(userId)
  // A switch that is on but has nobody to ask or hand over to: remind the owner weekly.
  if (s.enabled && s.stage !== 'HANDOVER_SENT') await warnIfUncovered(userId, 7 * DAY).catch(e => console.error('[busfactor] coverage warning failed', e))
  const required = s.stage === 'NOMINEES_ALERTED' ? await effectiveRequired(userId, s.requiredConfirmations) : s.requiredConfirmations
  const action = decide({
    now,
    enabled: s.enabled,
    stage: s.stage as Stage,
    lastCheckinAt: s.lastCheckinAt,
    createdAt: s.createdAt,
    stageChangedAt: s.stageChangedAt,
    pausedUntil: s.pausedUntil,
    holdEndsAt: s.holdEndsAt,
    reminder1AfterDays: s.reminder1AfterDays,
    reminder2AfterDays: s.reminder2AfterDays,
    nomineeAlertAfterDays: s.nomineeAlertAfterDays,
    requiredConfirmations: required,
    nomineeReminderHours: s.nomineeReminderHours,
    nomineeFinalHours: s.nomineeFinalHours,
    nomineeReminderSentAt: s.nomineeReminderSentAt,
    notOkCount: await notOkCount(userId, s.alertCycleId),
  })
  if (action.type === 'NONE') return action
  const u = await owner(userId)

  switch (action.type) {
    case 'SEND_REMINDER': {
      const from: Stage = action.n === 1 ? 'ACTIVE' : 'REMINDER_1'
      const to: Stage = action.n === 1 ? 'REMINDER_1' : 'REMINDER_2'
      if (await transition(userId, from, { stage: to })) {
        // Phone first. The first reminder goes by email only if no phone got it (or the owner asked for both);
        // the second reminder always goes by email too, because a notification can fail silently.
        const phones = await pushOwner(userId, {
          title: action.n === 1 ? 'Time for your check-in' : 'Second reminder: please check in',
          body: action.n === 1 ? 'Tap to tell busfactor you are OK.' : `${action.daysSince} days since your last check-in. Your contacts will be asked soon.`,
          url: await phoneCheckinUrl(userId), tag: 'checkin', urgent: action.n === 2,
        })
        const emailToo = action.n === 2 || phones === 0 || s.reminder1Email
        if (emailToo) await send(userId, u.email, Emails.reminder(action.n, u.name, action.daysSince, loginUrl(), await checkinUrl(userId)), `reminder ${action.n}`)
        await logEvent(userId, `REMINDER_${action.n}_SENT`, `${action.daysSince} days since check-in; ${[phones ? `phone (${phones})` : '', emailToo ? 'email' : ''].filter(Boolean).join(' and ')}`)
        await notifyChannels(userId, { event: `REMINDER_${action.n}`, title: action.n === 1 ? 'Time to check in' : 'Second reminder: check in now', message: `${action.daysSince} days since your last check-in.`, url: loginUrl() })
      }
      break
    }
    case 'ALERT_NOMINEES': {
      const confirmers = await acceptedNominees(userId, 'CONFIRMER')
      if (confirmers.length === 0) {
        const recent = await db.event.findFirst({ where: { userId, type: 'NO_NOMINEES', createdAt: { gt: new Date(now.getTime() - DAY) } } })
        if (!recent) {
          await logEvent(userId, 'NO_NOMINEES', 'Contacts should be asked now, but nobody has accepted an invitation')
          await warnIfUncovered(userId, DAY)
        }
        break
      }
      const cycleId = `c_${now.getTime()}_${randomBytes(4).toString('hex')}`
      if (await transition(userId, 'REMINDER_2', { stage: 'NOMINEES_ALERTED', alertCycleId: cycleId, nomineeReminderSentAt: null, holdReason: null })) {
        for (const n of confirmers) {
          const { token, hash } = newToken()
          await db.responseToken.create({ data: { tokenHash: hash, userId, nomineeId: n.id, cycleId, kind: 'RESPOND', expiresAt: new Date(now.getTime() + LINK_TTL_MS) } })
          await send(userId, n.email, Emails.nomineeAlert(n.name, u.name, action.daysSince, `${appUrl()}/n/respond?t=${token}`), 'contact alert')
        }
        await logEvent(userId, 'NOMINEES_ALERTED', confirmers.map(c => c.name).join(', '))
        await notifyChannels(userId, { event: 'NOMINEES_ALERTED', title: 'Your contacts are being asked if you are OK', message: 'Check in now if you are fine.', url: loginUrl() })
        await pushOwner(userId, { title: 'Your contacts are being asked if you are OK', body: 'Tap to check in and cancel it.', url: await phoneCheckinUrl(userId), tag: 'checkin', urgent: true })
      }
      break
    }
    case 'REMIND_NOMINEES': {
      const claim = await db.switch.updateMany({
        where: { userId, stage: 'NOMINEES_ALERTED', alertCycleId: s.alertCycleId, nomineeReminderSentAt: null },
        data: { nomineeReminderSentAt: now },
      })
      if (claim.count !== 1 || !s.alertCycleId) break
      const deadline = new Date(now.getTime() + s.nomineeFinalHours * HOUR)
      const answered = new Set((await db.responseToken.findMany({
        where: { userId, cycleId: s.alertCycleId, kind: 'RESPOND', respondedAt: { not: null } }, select: { nomineeId: true },
      })).map(r => r.nomineeId))
      const silent = (await acceptedNominees(userId, 'CONFIRMER')).filter(n => !answered.has(n.id))
      for (const n of silent) {
        const { token, hash } = newToken()
        await db.responseToken.create({ data: { tokenHash: hash, userId, nomineeId: n.id, cycleId: s.alertCycleId, kind: 'RESPOND', expiresAt: new Date(now.getTime() + LINK_TTL_MS) } })
        await send(userId, n.email, Emails.nomineeReminder(n.name, u.name, deadline, `${appUrl()}/n/respond?t=${token}`), 'contact reminder')
      }
      const cUrl = await checkinUrl(userId)
      await send(userId, u.email, Emails.nomineeReminderOwner(silent.map(n => n.name), deadline, cUrl), 'contact reminder (owner)')
      await logEvent(userId, 'NOMINEES_REMINDED', silent.map(n => n.name).join(', ') || 'everyone had answered')
      await notifyChannels(userId, { event: 'NOMINEES_REMINDED', title: 'Your contacts have been chased', message: `Handover starts ${deadline.toUTCString()} unless someone says you are OK.`, url: loginUrl() })
      await pushOwner(userId, { title: 'Your contacts have been reminded', body: 'Your handover will start soon. Tap to check in and cancel it.', url: await phoneCheckinUrl(userId), tag: 'checkin', urgent: true })
      break
    }
    case 'START_HOLD':
      await maybeStartHold(userId, action.reason)
      break
    case 'SEND_HANDOVER': {
      if (!(await transition(userId, 'HOLD', { stage: 'HANDOVER_SENT' }))) break
      const trusted = await acceptedNominees(userId, 'TRUSTED')
      const why = (s.holdReason as HoldReason) || 'CONFIRMED'
      const hasGeneral = s.instructionsMode !== 'NONE' && !!s.instructions
      const personalFor = new Set((await db.message.findMany({ where: { userId }, select: { nomineeId: true } })).map(m => m.nomineeId))
      const fallback = (await acceptedNominees(userId, 'CONFIRMER'))[0]?.name
      for (const n of trusted) {
        const personal = personalFor.has(n.id)
        let url: string | null = null
        if ((hasGeneral || personal) && s.alertCycleId) {
          const { token, hash } = newToken()
          await db.responseToken.create({ data: { tokenHash: hash, userId, nomineeId: n.id, cycleId: s.alertCycleId, kind: 'HANDOVER', expiresAt: new Date(now.getTime() + LINK_TTL_MS) } })
          url = `${appUrl()}/n/handover?t=${token}`
        }
        await send(userId, n.email, Emails.handover(n.name, u.name, url, why, s.instructionsMode === 'SEALED', fallback, personal), 'handover')
      }
      await send(userId, u.email, Emails.handoverSentOwner(trusted.map(t => t.name)), 'handover (owner copy)')
      await logEvent(userId, 'HANDOVER_SENT', trusted.map(t => t.name).join(', ') || 'NO TRUSTED CONTACT SET')
      await notifyChannels(userId, { event: 'HANDOVER_SENT', title: 'Handover sent', message: 'Your handover link has been sent to your trusted people.', url: loginUrl() })
      await pushOwner(userId, { title: 'Your handover was sent', body: 'Log in to cancel it: the links stop working as soon as you check in.', url: loginUrl(), tag: 'checkin', urgent: true })
      break
    }
  }
  return action
}

/** Run by cron every few minutes (POST /api/cron/tick). Safe to run as often as you like. */
export async function tickAll(now = new Date()) {
  const rows = await db.switch.findMany({ where: { enabled: true, stage: { not: 'HANDOVER_SENT' } }, select: { userId: true } })
  const results: Record<string, number> = {}
  for (const { userId } of rows) {
    try {
      const a = await tickUser(userId, now)
      results[a.type] = (results[a.type] ?? 0) + 1
    } catch (e) {
      results.ERROR = (results.ERROR ?? 0) + 1
      console.error('[busfactor] tick failed for a user', userId, e instanceof Error ? e.message : e)
    }
  }
  // Housekeeping: expired single-use tokens and challenges.
  await db.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } }).catch(() => {})
  await db.authChallenge.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
  await recordTick(now)
  return { checked: rows.length, results }
}

// ---------------------------------------------------------------- test mode

/** Sends a sample of every email to the owner only, marked [TEST]. Nobody else is contacted. */
export async function sendTestEmails(userId: string) {
  const s = await getSwitch(userId)
  const u = await owner(userId)
  const last = await db.event.findFirst({ where: { userId, type: 'TEST_EMAILS_SENT' }, orderBy: { createdAt: 'desc' } })
  if (last && Date.now() - last.createdAt.getTime() < 10 * 60 * 1000) throw new UserError('Test emails were sent a few minutes ago. Please wait 10 minutes.')
  const confirmer = (await acceptedNominees(userId, 'CONFIRMER'))[0]?.name || 'Your contact'
  const trustedNames = (await acceptedNominees(userId, 'TRUSTED')).map(t => t.name)
  const trusted = trustedNames[0] || 'Your trusted person'
  const fake = `${appUrl()}/n/respond?t=TEST-LINK-DOES-NOTHING`
  const fakeCheckin = `${appUrl()}/c?t=TEST-LINK-DOES-NOTHING`
  const inTwoDays = new Date(Date.now() + 2 * DAY)
  const deadline = new Date(Date.now() + s.nomineeFinalHours * HOUR)
  const hasPersonal = (await db.message.count({ where: { userId } })) > 0
  const mails = [
    Emails.reminder(1, u.name, s.reminder1AfterDays, loginUrl(), fakeCheckin),
    Emails.reminder(2, u.name, s.reminder2AfterDays, loginUrl(), fakeCheckin),
    Emails.nomineeAlert(confirmer, u.name, s.nomineeAlertAfterDays, fake),
    Emails.nomineeReminder(confirmer, u.name, deadline, fake),
    Emails.nomineeReminderOwner([confirmer], deadline, fakeCheckin),
    Emails.holdStartedOwner(u.name, inTwoDays, trustedNames.length ? trustedNames : [trusted], fakeCheckin, 'ONE_CONFIRMED_NO_REPLY'),
    Emails.handover(trusted, u.name, s.instructionsMode === 'NONE' && !hasPersonal ? null : `${appUrl()}/n/handover?t=TEST-LINK-DOES-NOTHING`, 'CONFIRMED', s.instructionsMode === 'SEALED', confirmer, hasPersonal),
    Emails.falseAlarm(confirmer, u.name, `${u.name} themselves`),
  ]
  let sent = 0
  let lastError: string | undefined
  for (const m of mails) {
    const r = await sendMail({ to: u.email, subject: `[TEST] ${m.subject}`, html: m.html })
    if (r.ok) sent++
    else lastError = r.error
  }
  await logEvent(userId, sent === mails.length ? 'TEST_EMAILS_SENT' : 'EMAIL_FAILED', `test: ${sent}/${mails.length} sent${lastError ? `: ${lastError}` : ''}`)
  return { sent, total: mails.length, to: u.email, error: lastError }
}
