import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from './db'
import { decPii, hashToken, newToken } from './crypto'

export const SESSION_COOKIE = 'bf_session'
export const PENDING_COOKIE = 'bf_2fa'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const hashPassword = (p: string) => bcrypt.hash(p, 12)
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h)

/** A bcrypt hash of a random string, compared against when the email is unknown so timing does not reveal accounts. */
const DUMMY_HASH = '$2b$12$q0Xd9qOl7Q/QnHyHDbq1IeIMSuDpf7nVW8OleUvZMBu1YrDkfyMl6'
export const verifyAgainstDummy = (p: string) => bcrypt.compare(p, DUMMY_HASH)

const cookieOpts = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  expires,
})

export async function createSession(userId: string) {
  const { token, hash } = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { tokenHash: hash, userId, expiresAt } })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, cookieOpts(expiresAt))
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  jar.delete(SESSION_COOKIE)
}

/** Half-finished login waiting for a second factor (10 minutes; attempts are capped in lib/twofactor.ts). */
export async function setPendingLogin(userId: string, forceEmail = false) {
  const { token, hash } = newToken()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await db.authChallenge.deleteMany({ where: { userId, purpose: 'LOGIN_2FA' } })
  await db.authChallenge.create({ data: { tokenHash: hash, userId, purpose: 'LOGIN_2FA', expiresAt, forceEmail } })
  const jar = await cookies()
  jar.set(PENDING_COOKIE, token, cookieOpts(expiresAt))
}

export async function getPendingLogin() {
  const jar = await cookies()
  const token = jar.get(PENDING_COOKIE)?.value
  if (!token) return null
  const row = await db.authChallenge.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row || row.purpose !== 'LOGIN_2FA' || row.expiresAt < new Date()) return null
  return row
}

export async function clearPendingLogin() {
  const jar = await cookies()
  const token = jar.get(PENDING_COOKIE)?.value
  if (token) await db.authChallenge.deleteMany({ where: { tokenHash: hashToken(token) } })
  jar.delete(PENDING_COOKIE)
}

export interface CurrentUser { id: string; name: string; email: string; emailVerifiedAt: Date | null; sessionId: string; reauthAt: Date | null }

export const REAUTH_WINDOW_MS = 15 * 60 * 1000
export const recentlyConfirmed = (u: CurrentUser) => !!u.reauthAt && Date.now() - u.reauthAt.getTime() < REAUTH_WINDOW_MS
export async function markReauth(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { reauthAt: new Date() } })
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const s = await db.session.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!s || s.expiresAt < new Date()) return null
  const u = await db.user.findUnique({ where: { id: s.userId }, select: { id: true, nameEnc: true, emailEnc: true, emailVerifiedAt: true } })
  if (!u) return null
  if (Date.now() - s.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  return { id: u.id, name: decPii(u.nameEnc), email: decPii(u.emailEnc), emailVerifiedAt: u.emailVerifiedAt, sessionId: s.id, reauthAt: s.reauthAt }
}

/** True while `key` has fewer than `max` hits in the window. Does not record anything. */
export async function underLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  return (await db.rateLimitHit.count({ where: { key, createdAt: { gt: new Date(Date.now() - windowMs) } } })) < max
}

/** Records a hit and returns its id, so it can be removed again (e.g. after a successful login). */
export async function recordHit(key: string): Promise<string> {
  return (await db.rateLimitHit.create({ data: { key } })).id
}

export async function removeHits(ids: string[]) {
  await db.rateLimitHit.deleteMany({ where: { id: { in: ids } } })
}

/** Simple database-backed rate limiter. Returns false when the limit is exceeded. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs)
  const count = await db.rateLimitHit.count({ where: { key, createdAt: { gt: since } } })
  if (count >= max) return false
  await db.rateLimitHit.create({ data: { key } })
  if (Math.random() < 0.01) await db.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => {})
  return true
}
