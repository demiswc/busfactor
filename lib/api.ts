import { NextResponse, type NextRequest } from 'next/server'
import ipaddr from 'ipaddr.js'
import { appUrl } from './config'
import { getCurrentUser, recentlyConfirmed, type CurrentUser } from './auth'
import { UserError } from './engine/service'

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** Blocks cross-site form posts (CSRF). Same-site requests from our own pages pass. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      const o = new URL(origin)
      return o.host === new URL(appUrl()).host || o.host === req.headers.get('host')
    } catch { return false }
  }
  return req.headers.get('sec-fetch-site') !== 'cross-site'
}

/**
 * The client's address. Proxies append to X-Forwarded-For, so we count TRUST_PROXY_HOPS entries
 * from the right (default 1: one reverse proxy such as Caddy or nginx in front of the app).
 * Entries further left are supplied by the client and cannot be trusted.
 */
export function clientIp(req: NextRequest): string {
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS || 1))
  const chain = (req.headers.get('x-forwarded-for') || '').split(',').map(x => x.trim()).filter(Boolean)
  const ip = chain[chain.length - hops] || req.headers.get('x-real-ip') || 'unknown'
  return rateKeyForIp(ip)
}

/** IPv6 users typically control a whole /64, so rate limits treat a /64 as one address. */
export function rateKeyForIp(ip: string): string {
  if (!ip.includes(':')) return ip
  try { return ipaddr.parse(ip).toNormalizedString().split(':').slice(0, 4).join(':') + '::/64' } catch { return ip }
}

export class TooLarge extends Error {}

/** Reads a JSON body, refusing anything over maxBytes (default 64 KB) before and after reading. */
export async function body<T = Record<string, unknown>>(req: NextRequest, maxBytes = 64 * 1024): Promise<T> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new TooLarge()
  if (!req.body) return {} as T
  // Stream with a running count, so a body without Content-Length cannot fill memory either.
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new TooLarge() }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return {} as T }
}

type Handler = (req: NextRequest) => Promise<Response>
type AuthedHandler = (req: NextRequest, user: CurrentUser) => Promise<Response>

function wrap(fn: Handler, mutating: boolean): Handler {
  return async req => {
    if (mutating && !sameOrigin(req)) return fail('Cross-site request refused.', 403)
    try {
      return await fn(req)
    } catch (e) {
      if (e instanceof UserError) return fail(e.message)
      if (e instanceof TooLarge) return fail('That request is too large.', 413)
      console.error('[busfactor] api error', e)
      return fail('Something went wrong. Please try again.', 500)
    }
  }
}

export const publicRoute = (fn: Handler, mutating = true) => wrap(fn, mutating)

export const authedRoute = (fn: AuthedHandler, mutating = true) =>
  wrap(async req => {
    const user = await getCurrentUser()
    if (!user) return fail('Please log in.', 401)
    return fn(req, user)
  }, mutating)

/**
 * For changes that could weaken the switch (turning it off, contacts, instructions, channels):
 * the password must have been re-entered in the last 15 minutes, so a stolen session alone is not enough.
 */
export const sudoRoute = (fn: AuthedHandler) =>
  authedRoute(async (req, user) => {
    if (!recentlyConfirmed(user)) return NextResponse.json({ error: 'Please confirm your password at the top of this page first.', reauth: true }, { status: 403 })
    return fn(req, user)
  })
