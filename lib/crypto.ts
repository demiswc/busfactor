import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Server-side cryptography.
 *
 * APP_ENCRYPTION_KEY (32 random bytes, base64) is the root secret. Separate subkeys are derived
 * from it with HKDF for each purpose, so one use can never be confused with another:
 *   - "pii"          encrypts names, email addresses, event details and alert-channel URLs at rest
 *   - "lookup"       keyed fingerprint (HMAC) of email addresses, for finding accounts without storing them
 *   - "instructions" encrypts handover instructions in SERVER mode (if the operator allows that mode)
 *   - "totp"         encrypts authenticator-app secrets
 *
 * Ciphertext format: <tag>:<iv>:<authTag>:<data>, all base64, AES-256-GCM.
 */
type Purpose = 'pii' | 'lookup' | 'instructions' | 'totp'

let rootCache: { raw: string; key: Buffer } | null = null
function root(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || ''
  if (rootCache?.raw === raw) return rootCache.key
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)')
  rootCache = { raw, key: k }
  return k
}

const subkeys = new Map<string, Buffer>()
function subkey(p: Purpose): Buffer {
  const r = root()
  const id = `${r.toString('base64')}:${p}`
  let k = subkeys.get(id)
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', r, Buffer.from('busfactor-v1'), Buffer.from(p), 32))
    subkeys.clear()
    subkeys.set(id, k)
  }
  return k
}

export function hasEncryptionKey(): boolean {
  try { root(); return true } catch { return false }
}

function seal(p: Purpose, tag: string, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', subkey(p), iv)
  c.setAAD(Buffer.from(tag))
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [tag, iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

function open(p: Purpose, tag: string, enc: string): string {
  const [t, iv, at, data] = enc.split(':')
  if (t !== tag || !iv || !at || data === undefined) throw new Error('Unknown ciphertext format')
  const d = createDecipheriv('aes-256-gcm', subkey(p), Buffer.from(iv, 'base64'))
  d.setAAD(Buffer.from(tag))
  d.setAuthTag(Buffer.from(at, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}

/** Personal details at rest. */
export const encPii = (plain: string) => seal('pii', 'p1', plain)
export const decPii = (enc: string) => open('pii', 'p1', enc)
export const encPiiOpt = (plain: string | null | undefined) => (plain ? encPii(plain) : null)
export const decPiiOpt = (enc: string | null | undefined) => (enc ? decPii(enc) : null)

/** Handover instructions in SERVER mode. */
export const encryptText = (plain: string) => seal('instructions', 'i1', plain)
export const decryptText = (enc: string) => open('instructions', 'i1', enc)

/** Authenticator-app secrets. */
export const encTotp = (plain: string) => seal('totp', 't1', plain)
export const decTotp = (enc: string) => open('totp', 't1', enc)

export const normaliseEmail = (e: string) => (e ?? '').trim().toLowerCase()

/** Keyed fingerprint of an email address: equal emails give equal hashes, but it cannot be reversed without the key. */
export function emailHash(email: string): string {
  return createHmac('sha256', subkey('lookup')).update(normaliseEmail(email)).digest('hex')
}

/** Keyed fingerprint of any lookup value (e.g. a push endpoint). */
export function lookupHash(kind: string, value: string): string {
  return createHmac('sha256', subkey('lookup')).update(`${kind}:${value}`).digest('hex')
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

/** A random URL-safe token; only its hash is ever stored. */
export function newToken(prefix = ''): { token: string; hash: string } {
  const token = prefix + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Operators of a public service should turn SERVER mode off, so they never hold readable instructions. */
export function serverInstructionsAllowed(): boolean {
  return process.env.ALLOW_SERVER_INSTRUCTIONS !== 'false' && hasEncryptionKey()
}
