/** Authenticator-app codes (RFC 6238 TOTP, SHA-1, 6 digits, 30 s): what Google Authenticator, 1Password, Authy and YubiKey OATH use. */
import { createHmac, randomBytes } from 'crypto'
import { safeEqual } from './crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const b of buf) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('Invalid base32')
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const off = h[h.length - 1] & 15
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString()
  return code.padStart(6, '0')
}

/** Accepts the current code and one step either side (clock drift). Returns the matched counter, or null. */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  const c = (code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const step = Math.floor(now / 30_000)
  for (const d of [0, -1, 1]) if (safeEqual(totpAt(secret, step + d), c)) return step + d
  return null
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
