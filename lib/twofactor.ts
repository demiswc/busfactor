/**
 * Second login factors:
 *   - Passkeys / security keys (WebAuthn: YubiKey, Face ID, Windows Hello, phone)  — strongest
 *   - Authenticator app codes (TOTP)
 *   - Email codes (a 6-digit code sent to the account email)                           — easiest
 *   - Recovery codes (10 single-use codes, issued with passkeys or an authenticator app)
 */
import { randomBytes, randomInt } from 'crypto'
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import QRCode from 'qrcode'
import { db } from './db'
import { APP_NAME, appUrl } from './config'
import { decPii, decTotp, encTotp, hashToken, newToken, safeEqual } from './crypto'
import { Emails } from './emails'
import { sendMail } from './mail'
import { clearPendingLogin, createSession, getPendingLogin, rateLimit } from './auth'
import { UserError } from './errors'
import { logEvent } from './engine/service'
import { newTotpSecret, otpauthUri, verifyTotp } from './totp'

export type Factor = 'passkey' | 'totp' | 'email' | 'recovery'

const rp = () => { const u = new URL(appUrl()); return { rpID: u.hostname, origin: u.origin } }
const TEN_MIN = 10 * 60 * 1000

export async function secondFactorsFor(userId: string): Promise<Factor[]> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, emailOtpEnabled: true, recoveryCodes: true } })
  const passkeys = await db.passkey.count({ where: { userId } })
  const out: Factor[] = []
  if (passkeys) out.push('passkey')
  if (u.totpEnabledAt) out.push('totp')
  if (u.emailOtpEnabled) out.push('email')
  if (out.length && u.recoveryCodes && JSON.parse(u.recoveryCodes).length) out.push('recovery')
  return out
}

// ------------------------------------------------------------------ recovery codes

function makeRecoveryCodes() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const code = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')).join('-')
  const codes = Array.from({ length: 10 }, code)
  return { codes, stored: JSON.stringify(codes.map(c => hashToken(c))) }
}

async function ensureRecoveryCodes(userId: string): Promise<string[] | null> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { recoveryCodes: true } })
  if (u.recoveryCodes && JSON.parse(u.recoveryCodes).length) return null
  const { codes, stored } = makeRecoveryCodes()
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: stored } })
  return codes
}

export async function regenerateRecoveryCodes(userId: string) {
  const { codes, stored } = makeRecoveryCodes()
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: stored } })
  await logEvent(userId, 'RECOVERY_CODES_REGENERATED')
  return codes
}

// ------------------------------------------------------------------ login: second step

export const MAX_2FA_ATTEMPTS = 10

/**
 * Every call claims one attempt atomically BEFORE anything is checked, so parallel requests
 * cannot get more than MAX_2FA_ATTEMPTS guesses against one pending login.
 */
async function pending(isCodeGuess = true) {
  const p = await getPendingLogin()
  if (!p) throw new UserError('Your login has expired. Please enter your email and password again.')
  const claim = await db.authChallenge.updateMany({
    where: { id: p.id, attempts: { lt: MAX_2FA_ATTEMPTS }, expiresAt: { gt: new Date() } },
    data: { attempts: { increment: 1 } },
  })
  if (claim.count !== 1) {
    // First time the cap is hit on this login: warn the owner that someone knows their password.
    const first = await db.authChallenge.updateMany({ where: { id: p.id, attempts: MAX_2FA_ATTEMPTS }, data: { attempts: MAX_2FA_ATTEMPTS + 1 } })
    if (first.count === 1) {
      const u = await db.user.findUniqueOrThrow({ where: { id: p.userId } })
      await sendMail({ to: decPii(u.emailEnc), ...Emails.secondFactorFailures(decPii(u.nameEnc), `${appUrl()}/login?next=/settings`) })
      await logEvent(u.id, 'SECOND_FACTOR_FAILURES')
    }
    throw new UserError('Too many attempts. Please log in again.')
  }
  // Only guessable codes count towards the per-account limit (not passkey challenges or sending an email code).
  if (isCodeGuess && !(await rateLimit(`2fa:${p.userId}`, 30, 15 * 60 * 1000))) throw new UserError('Too many attempts. Please wait 15 minutes.')
  return p
}

async function finish(userId: string, how: string) {
  await clearPendingLogin()
  await createSession(userId)
  await logEvent(userId, 'LOGIN', how)
}

export async function loginWithTotp(code: string) {
  const p = await pending()
  const u = await db.user.findUniqueOrThrow({ where: { id: p.userId } })
  const step = u.totpSecretEnc ? verifyTotp(decTotp(u.totpSecretEnc), code) : null
  if (step === null) throw new UserError('That code is not right. Try the newest code.')
  // Each code works once: the time-step must be newer than the last one used (atomic).
  const used = await db.user.updateMany({
    where: { id: u.id, OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: step } }] },
    data: { totpLastCounter: step },
  })
  if (used.count !== 1) throw new UserError('That code has already been used. Wait for the next one.')
  await finish(u.id, 'authenticator app')
}

export async function loginWithRecovery(code: string) {
  const p = await pending()
  const u = await db.user.findUniqueOrThrow({ where: { id: p.userId } })
  const list: string[] = u.recoveryCodes ? JSON.parse(u.recoveryCodes) : []
  const h = hashToken((code ?? '').trim().toLowerCase())
  const idx = list.findIndex(x => safeEqual(x, h))
  if (idx < 0) throw new UserError('That recovery code is not valid.')
  list.splice(idx, 1)
  // Conditional on the list being unchanged, so one code cannot be spent twice in a race.
  const upd = await db.user.updateMany({ where: { id: u.id, recoveryCodes: u.recoveryCodes }, data: { recoveryCodes: JSON.stringify(list) } })
  if (upd.count !== 1) throw new UserError('Please try again.')
  await finish(u.id, `recovery code (${list.length} left)`)
}

export async function sendLoginEmailCode() {
  const p = await pending(false)
  const u = await db.user.findUniqueOrThrow({ where: { id: p.userId } })
  if (!u.emailOtpEnabled && !p.forceEmail) throw new UserError('Email codes are not switched on for this account.')
  if (p.emailCodeAt && Date.now() - p.emailCodeAt.getTime() < 60_000) throw new UserError('A code was just sent. Please check your inbox (and spam).')
  if (!(await rateLimit(`email-otp:${u.id}`, 5, 60 * 60 * 1000))) throw new UserError('Too many codes requested. Please wait an hour.')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.authChallenge.update({ where: { id: p.id }, data: { emailCodeHash: hashToken(`${p.id}:${code}`), emailCodeAt: new Date() } })
  await sendMail({ to: decPii(u.emailEnc), ...Emails.loginCode(decPii(u.nameEnc), code) })
}

export async function loginWithEmailCode(code: string) {
  const p = await pending()
  const c = (code ?? '').replace(/\s/g, '')
  if (!p.emailCodeHash || !p.emailCodeAt || Date.now() - p.emailCodeAt.getTime() > TEN_MIN || !safeEqual(p.emailCodeHash, hashToken(`${p.id}:${c}`))) {
    throw new UserError('That code is not right, or it has expired.')
  }
  await finish(p.userId, 'email code')
}

export async function passkeyLoginOptions() {
  const p = await pending(false)
  const keys = await db.passkey.findMany({ where: { userId: p.userId } })
  if (!keys.length) throw new UserError('No passkeys on this account.')
  const opts = await generateAuthenticationOptions({
    rpID: rp().rpID, userVerification: 'preferred',
    allowCredentials: keys.map(k => ({ id: k.credentialId, transports: k.transports ? (k.transports.split(',') as AuthenticatorTransport[]) : undefined })),
  })
  await db.authChallenge.update({ where: { id: p.id }, data: { challenge: opts.challenge } })
  return opts
}

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'

export async function loginWithPasskey(response: AuthenticationResponseJSON) {
  const p = await pending(false) // a signature from a security key cannot be guessed
  if (!p.challenge) throw new UserError('Please try the passkey again.')
  const key = await db.passkey.findFirst({ where: { userId: p.userId, credentialId: String(response?.id ?? '') } })
  if (!key) throw new UserError('That passkey is not registered on this account.')
  let ok = false
  try {
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: p.challenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: false,
      credential: { id: key.credentialId, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports?.split(',') as AuthenticatorTransport[] | undefined },
    })
    ok = v.verified
    if (ok) await db.passkey.update({ where: { id: key.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } })
  } catch { ok = false }
  if (!ok) throw new UserError('The passkey could not be verified.')
  await finish(p.userId, `passkey "${key.name}"`)
}

// ------------------------------------------------------------------ setup (logged in)

export async function totpBegin(userId: string, accountEmail: string) {
  const secret = newTotpSecret()
  const { token, hash } = newToken()
  await db.authChallenge.deleteMany({ where: { userId, purpose: 'TOTP_SETUP' } })
  await db.authChallenge.create({ data: { tokenHash: hash, userId, purpose: 'TOTP_SETUP', challenge: encTotp(secret), expiresAt: new Date(Date.now() + TEN_MIN) } })
  const uri = otpauthUri(secret, accountEmail, APP_NAME)
  return { setupId: token, secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) }
}

export async function totpConfirm(userId: string, setupId: string, code: string) {
  const row = await db.authChallenge.findUnique({ where: { tokenHash: hashToken(setupId ?? '') } })
  if (!row || row.userId !== userId || row.purpose !== 'TOTP_SETUP' || row.expiresAt < new Date() || !row.challenge) throw new UserError('Setup expired. Please start again.')
  const secret = decTotp(row.challenge)
  const step = verifyTotp(secret, code)
  if (step === null) throw new UserError('That code is not right. Check the time on your phone and try the newest code.')
  await db.user.update({ where: { id: userId }, data: { totpSecretEnc: encTotp(secret), totpEnabledAt: new Date(), totpLastCounter: step } })
  await db.authChallenge.delete({ where: { id: row.id } })
  await logEvent(userId, 'TOTP_ENABLED')
  return { recoveryCodes: await ensureRecoveryCodes(userId) }
}

export async function totpDisable(userId: string) {
  await db.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastCounter: null } })
  await logEvent(userId, 'TOTP_DISABLED')
}

export async function setEmailOtp(userId: string, on: boolean) {
  await db.user.update({ where: { id: userId }, data: { emailOtpEnabled: on } })
  await logEvent(userId, on ? 'EMAIL_CODES_ENABLED' : 'EMAIL_CODES_DISABLED')
}

export async function passkeyRegisterOptions(userId: string, name: string, email: string) {
  const existing = await db.passkey.findMany({ where: { userId } })
  if (existing.length >= 10) throw new UserError('You can register up to 10 passkeys.')
  const opts = await generateRegistrationOptions({
    rpName: APP_NAME, rpID: rp().rpID, userName: email, userDisplayName: name,
    userID: new TextEncoder().encode(userId), attestationType: 'none',
    excludeCredentials: existing.map(k => ({ id: k.credentialId })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  await db.authChallenge.deleteMany({ where: { userId, purpose: 'PASSKEY_REGISTER' } })
  await db.authChallenge.create({ data: { tokenHash: hashToken(randomBytes(16).toString('hex')), userId, purpose: 'PASSKEY_REGISTER', challenge: opts.challenge, expiresAt: new Date(Date.now() + TEN_MIN) } })
  return opts
}

export async function passkeyRegisterVerify(userId: string, response: RegistrationResponseJSON, label: string) {
  const row = await db.authChallenge.findFirst({ where: { userId, purpose: 'PASSKEY_REGISTER' } })
  if (!row?.challenge || row.expiresAt < new Date()) throw new UserError('Setup expired. Please try again.')
  let v
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge: row.challenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: false })
  } catch (e) { throw new UserError(`The passkey could not be registered: ${(e as Error).message}`) }
  if (!v.verified) throw new UserError('The passkey could not be verified.')
  const c = v.registrationInfo.credential
  await db.passkey.create({
    data: {
      userId, credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter,
      transports: c.transports?.join(',') || null, name: (label ?? '').trim().slice(0, 100) || 'Passkey',
    },
  })
  await db.authChallenge.delete({ where: { id: row.id } })
  await logEvent(userId, 'PASSKEY_ADDED', label)
  return { recoveryCodes: await ensureRecoveryCodes(userId) }
}

export async function removePasskey(userId: string, id: string) {
  const res = await db.passkey.deleteMany({ where: { id, userId } })
  if (res.count) await logEvent(userId, 'PASSKEY_REMOVED', id)
}
