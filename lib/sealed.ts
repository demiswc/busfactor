/**
 * Browser-side encryption. The server only ever stores the outputs and cannot read them.
 * Works in browsers and Node 20+ (WebCrypto + hash-wasm).
 *
 * 1. Passphrase boxes (general instructions):
 *      v2  Argon2id (64 MiB, 3 passes) -> AES-256-GCM     (current)
 *      v1  PBKDF2-SHA256 600k           -> AES-256-GCM     (still opens)
 *
 * 2. Recipient keys (personal messages): when a trusted person accepts their invitation, their browser
 *    makes an ECDH P-256 key pair. The public key goes to the server; the private key is stored only
 *    inside a v2 passphrase box that the recipient chose. The owner's browser encrypts each message to
 *    that public key (ephemeral ECDH -> HKDF-SHA256 -> AES-256-GCM), so only the recipient can open it,
 *    and nobody has to hand over a passphrase in advance.
 */
import { argon2id } from 'hash-wasm'

const enc = new TextEncoder()
const dec = new TextDecoder()

export const b64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const buf = (u: Uint8Array) => u as unknown as BufferSource

// ------------------------------------------------------------------ passphrase boxes

interface BoxV1 { v: 1; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; ct: string }
interface BoxV2 { v: 2; kdf: 'ARGON2ID'; m: number; t: number; p: number; salt: string; iv: string; ct: string }
export type SealedBox = BoxV1 | BoxV2

const ARGON = { m: 65536, t: 3, p: 1 } // 64 MiB: strong, and still fine on a phone

async function argonKey(passphrase: string, salt: Uint8Array, m: number, t: number, p: number) {
  const raw = await argon2id({ password: passphrase.normalize('NFKC'), salt, parallelism: p, iterations: t, memorySize: m, hashLength: 32, outputType: 'binary' })
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function pbkdf2Key(passphrase: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function sealText(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await argonKey(passphrase, salt, ARGON.m, ARGON.t, ARGON.p)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, k, enc.encode(plain))
  const box: BoxV2 = { v: 2, kdf: 'ARGON2ID', ...ARGON, salt: b64(salt), iv: b64(iv), ct: b64(ct) }
  return JSON.stringify(box)
}

/** Throws if the passphrase is wrong (AES-GCM authentication fails). */
export async function openSealed(sealed: string, passphrase: string): Promise<string> {
  const box = JSON.parse(sealed) as SealedBox
  let k: CryptoKey
  if (box.v === 2 && box.kdf === 'ARGON2ID') k = await argonKey(passphrase, unb64(box.salt), box.m, box.t, box.p)
  else if (box.v === 1 && box.kdf === 'PBKDF2-SHA256') k = await pbkdf2Key(passphrase, unb64(box.salt), box.iter)
  else throw new Error('Unknown sealed format')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(unb64(box.iv)) }, k, buf(unb64(box.ct)))
  return dec.decode(pt)
}

/** Server-side sanity check that a value looks like a sealed box (without being able to open it). */
export function isSealedBox(s: string, maxCt = 2_000_000): boolean {
  try {
    const b = JSON.parse(s)
    const common = typeof b?.salt === 'string' && typeof b.iv === 'string' && typeof b.ct === 'string' && b.ct.length < maxCt
    if (b?.v === 2) return common && b.kdf === 'ARGON2ID' && b.m >= 19456 && b.m <= 1_048_576 && b.t >= 2 && b.t <= 10 && b.p >= 1 && b.p <= 8
    if (b?.v === 1) return common && b.kdf === 'PBKDF2-SHA256' && b.iter >= 100_000
    return false
  } catch { return false }
}

// ------------------------------------------------------------------ recipient keys

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface RecipientKeys { publicKey: string; encPrivateKey: string }

/** Run in the trusted person's browser when they accept: makes their key pair, locked with their passphrase. */
export async function createRecipientKeys(passphrase: string): Promise<RecipientKeys> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const priv = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return {
    publicKey: JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }),
    encPrivateKey: await sealText(b64(priv), passphrase),
  }
}

interface RecipientBox { v: 1; alg: 'ECDH-P256+HKDF-SHA256+A256GCM'; epk: JsonWebKey; iv: string; ct: string }

async function sharedKey(privateKey: CryptoKey, publicKey: CryptoKey, info: string) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: buf(new Uint8Array(32)), info: enc.encode(info) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Run in the owner's browser: encrypts a message so that only the holder of `recipientPublicKey` can open it. */
export async function sealForRecipient(plain: string, recipientPublicKey: string): Promise<string> {
  const rpub = await crypto.subtle.importKey('jwk', JSON.parse(recipientPublicKey), ECDH, false, [])
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey)
  const k = await sharedKey(eph.privateKey, rpub, 'busfactor message v1')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, k, enc.encode(plain))
  const box: RecipientBox = { v: 1, alg: 'ECDH-P256+HKDF-SHA256+A256GCM', epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y }, iv: b64(iv), ct: b64(ct) }
  return JSON.stringify(box)
}

/** Run in the recipient's browser: unlocks their private key with their passphrase, then opens the message. */
export async function openForRecipient(box: string, encPrivateKey: string, passphrase: string): Promise<string> {
  const privB64 = await openSealed(encPrivateKey, passphrase)
  const priv = await crypto.subtle.importKey('pkcs8', buf(unb64(privB64)), ECDH, false, ['deriveBits'])
  const b = JSON.parse(box) as RecipientBox
  if (b.v !== 1 || b.alg !== 'ECDH-P256+HKDF-SHA256+A256GCM') throw new Error('Unknown message format')
  const epk = await crypto.subtle.importKey('jwk', b.epk, ECDH, false, [])
  const k = await sharedKey(priv, epk, 'busfactor message v1')
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(unb64(b.iv)) }, k, buf(unb64(b.ct))))
}

export function isRecipientBox(s: string, maxCt = 30_000_000): boolean {
  try {
    const b = JSON.parse(s)
    return b?.v === 1 && b.alg === 'ECDH-P256+HKDF-SHA256+A256GCM' && b.epk?.kty === 'EC' && b.epk?.crv === 'P-256' &&
      typeof b.iv === 'string' && typeof b.ct === 'string' && b.ct.length < maxCt
  } catch { return false }
}

export function isPublicKeyJwk(s: string): boolean {
  try {
    const k = JSON.parse(s)
    return k?.kty === 'EC' && k.crv === 'P-256' && typeof k.x === 'string' && typeof k.y === 'string' && !('d' in k)
  } catch { return false }
}

/** What goes inside a personal message box. */
export interface MessagePayload { text: string; files: Array<{ name: string; type: string; size: number; data: string }> }

/**
 * Short, human-comparable fingerprint of a recipient's public key, e.g. "3F2A 91C0 7B1D 44E2 A0C9".
 * The owner sees it in Settings and the trusted person sees it when they set up; if they match
 * (compare by phone), nobody has swapped the key.
 */
export async function keyFingerprint(publicKey: string): Promise<string> {
  const k = JSON.parse(publicKey) as { crv: string; x: string; y: string }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${k.crv}:${k.x}:${k.y}`)))
  const hex = Array.from(digest.slice(0, 10), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return hex.match(/.{4}/g)!.join(' ')
}
