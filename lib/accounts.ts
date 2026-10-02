/** Account flows: sign up, verify email, log in (with optional second factor), reset password, delete account. */
import { db } from './db'
import { appUrl, LIMITS } from './config'
import { decPii, emailHash, encPii, hashToken, newToken, normaliseEmail } from './crypto'
import { Emails } from './emails'
import { sendMail } from './mail'
import { createSession, hashPassword, rateLimit, recordHit, removeHits, setPendingLogin, underLimit, verifyAgainstDummy, verifyPassword } from './auth'
import { UserError } from './errors'
import { logEvent } from './engine/service'
import { secondFactorsFor } from './twofactor'
import { bump } from './metrics'

const HOUR = 60 * 60 * 1000
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function checkPassword(p: string) {
  if (typeof p !== 'string' || p.length < LIMITS.passwordMin) throw new UserError(`Password must be at least ${LIMITS.passwordMin} characters.`)
  if (p.length > 200) throw new UserError('Password is too long.')
}

async function issueAuthToken(userId: string, purpose: 'VERIFY' | 'RESET', ttlMs: number) {
  const { token, hash } = newToken()
  await db.authToken.create({ data: { tokenHash: hash, userId, purpose, expiresAt: new Date(Date.now() + ttlMs) } })
  return token
}

async function consumeAuthToken(token: string, purpose: 'VERIFY' | 'RESET') {
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token ?? '') } })
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) return null
  const upd = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  return upd.count === 1 ? row : null
}

const who = (u: { nameEnc: string; emailEnc: string }) => ({ name: decPii(u.nameEnc), email: decPii(u.emailEnc) })

export async function signup(input: { name: string; email: string; password: string }, ip: string) {
  const name = (input.name ?? '').trim().slice(0, 100)
  const email = normaliseEmail(input.email)
  if (!name) throw new UserError('Please enter your name.')
  if (!EMAIL_RE.test(email) || email.length > 190) throw new UserError('Please enter a valid email address.')
  checkPassword(input.password)
  if (!(await rateLimit(`signup:${ip}`, 5, HOUR))) throw new UserError('Too many sign-ups from here. Please try again later.')

  const existing = await db.user.findUnique({ where: { emailHash: emailHash(email) } })
  if (existing) {
    // Do not reveal that the account exists; tell the real owner instead.
    await sendMail({ to: email, ...Emails.accountExists(who(existing).name, `${appUrl()}/login`, `${appUrl()}/forgot`) })
    return
  }
  const user = await db.user.create({
    data: { emailHash: emailHash(email), emailEnc: encPii(email), nameEnc: encPii(name), passwordHash: await hashPassword(input.password), switch: { create: {} } },
  })
  await logEvent(user.id, 'ACCOUNT_CREATED')
  const token = await issueAuthToken(user.id, 'VERIFY', 7 * 24 * HOUR)
  await sendMail({ to: email, ...Emails.verifyEmail(name, `${appUrl()}/verify?t=${token}`) })
  // No automatic login: the response is identical whether or not the email already had an account.
}

export async function resendVerification(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (u.emailVerifiedAt) return
  if (!(await rateLimit(`verify:${userId}`, 3, HOUR))) throw new UserError('Please wait a while before asking again.')
  const token = await issueAuthToken(u.id, 'VERIFY', 7 * 24 * HOUR)
  const w = who(u)
  await sendMail({ to: w.email, ...Emails.verifyEmail(w.name, `${appUrl()}/verify?t=${token}`) })
}

export async function verifyEmail(token: string) {
  const row = await consumeAuthToken(token, 'VERIFY')
  if (!row) return false
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } })
  await logEvent(row.userId, 'EMAIL_VERIFIED')
  return true
}

/** Returns { twoFactor: methods[] } when a second step is needed; otherwise logs straight in. */
export async function login(input: { email: string; password: string }, ip: string) {
  const email = normaliseEmail(input.email)
  const key = email ? emailHash(email) : 'none'
  const ipKey = `login-fail-ip:${ip}`, accountKey = `login-fail:${key}`
  // Per address: a hard limit of 20 failures per 15 minutes (IPv6 counted per /64).
  if (!(await underLimit(ipKey, 20, 15 * 60 * 1000))) throw new UserError('Too many failed attempts from here. Please wait 15 minutes. (Reminder emails also contain a one-click check-in link.)')
  // Per account: after 100 failures an hour we do NOT lock the owner out. The right password still works,
  // but also needs a code sent to their email, so a password-guesser gets nowhere.
  const accountUnderAttack = !(await underLimit(accountKey, 100, HOUR))
  // Record the failure BEFORE the slow password check, so parallel bursts cannot overshoot the limits.
  const hits = await Promise.all([recordHit(ipKey), recordHit(accountKey)])
  const user = email ? await db.user.findUnique({ where: { emailHash: key } }) : null
  const valid = user ? await verifyPassword(input.password ?? '', user.passwordHash) : await verifyAgainstDummy(input.password ?? '')
  if (!user || !valid) throw new UserError('Email or password is incorrect.')
  await removeHits(hits) // a correct password is not a failure
  let methods = await secondFactorsFor(user.id)
  if (accountUnderAttack && !methods.includes('email')) methods = ['email', ...methods.filter(m => m !== 'recovery'), ...methods.filter(m => m === 'recovery')]
  if (methods.length) {
    await setPendingLogin(user.id, accountUnderAttack)
    return { twoFactor: methods, notice: accountUnderAttack ? 'Someone has been trying to guess your password, so this time we also need a code from your email.' : undefined }
  }
  await createSession(user.id)
  await logEvent(user.id, 'LOGIN')
  return { twoFactor: null }
}

export async function forgotPassword(emailRaw: string, ip: string) {
  const email = normaliseEmail(emailRaw)
  if (!(await rateLimit(`forgot:${ip}`, 5, HOUR)) || !(await rateLimit(`forgot:${emailHash(email)}`, 3, HOUR))) return
  const user = await db.user.findUnique({ where: { emailHash: emailHash(email) } })
  if (!user) return
  const token = await issueAuthToken(user.id, 'RESET', HOUR)
  await sendMail({ to: email, ...Emails.passwordReset(who(user).name, `${appUrl()}/reset?t=${token}`) })
}

/** Resetting a password does not remove two-factor: the reset link alone cannot take over a protected account. */
export async function resetPassword(token: string, password: string) {
  checkPassword(password)
  const row = await consumeAuthToken(token, 'RESET')
  if (!row) throw new UserError('This reset link is not valid or has expired.')
  const user = await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } })
  await db.session.deleteMany({ where: { userId: user.id } })
  await logEvent(user.id, 'PASSWORD_RESET')
  const w = who(user)
  await sendMail({ to: w.email, ...Emails.passwordChanged(w.name) })
}

export async function changePassword(userId: string, current: string, next: string) {
  checkPassword(next)
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await verifyPassword(current ?? '', user.passwordHash))) throw new UserError('Your current password is incorrect.')
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } })
  await db.session.deleteMany({ where: { userId } })
  await createSession(userId)
  await logEvent(userId, 'PASSWORD_CHANGED')
  const w = who(user)
  await sendMail({ to: w.email, ...Emails.passwordChanged(w.name) })
}

export async function requirePassword(userId: string, password: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await rateLimit(`pw-confirm:${userId}`, 10, 15 * 60 * 1000))) throw new UserError('Too many attempts. Please wait 15 minutes.')
  if (!(await verifyPassword(password ?? '', user.passwordHash))) throw new UserError('Password is incorrect.')
}

/** Deletes the account and everything linked to it (cascade). */
export async function deleteAccount(userId: string, password: string) {
  await requirePassword(userId, password)
  await db.user.delete({ where: { id: userId } })
  await bump('account_deleted')
}
