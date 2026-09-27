/**
 * Extra alert channels for the account owner (besides email): ntfy, Discord, Slack, Telegram,
 * or any webhook (JSON, HMAC-signed). Used both for reminders that must not be missed and for
 * automation (e.g. switch a site to maintenance mode when the handover is sent).
 *
 * The server fetches user-supplied URLs, so every request is guarded against SSRF: HTTPS only
 * (unless the operator allows private targets), DNS resolved and private/loopback/link-local
 * addresses refused, no redirects, short timeout.
 */
import { createHmac } from 'crypto'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import ipaddr from 'ipaddr.js'
import { request } from 'https'
import { request as httpRequest } from 'http'

export interface Channel { id: string; label: string; url: string }
export type ChannelKind = 'ntfy' | 'discord' | 'slack' | 'telegram' | 'webhook'

export interface AlertEvent {
  event: string // e.g. REMINDER_1, NOMINEES_ALERTED, HOLD_STARTED, HANDOVER_SENT, ALL_CLEAR, TEST
  title: string
  message: string
  url?: string
  at: string
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === 'true'

export function channelKind(url: string): ChannelKind {
  const u = new URL(url)
  if (u.hostname === 'discord.com' || u.hostname === 'discordapp.com') return 'discord'
  if (u.hostname === 'hooks.slack.com') return 'slack'
  if (u.hostname === 'api.telegram.org') return 'telegram'
  if (u.hostname === 'ntfy.sh' || u.hostname.startsWith('ntfy.')) return 'ntfy' // ntfy.sh or a self-hosted ntfy.example.com
  return 'webhook'
}

/**
 * True for anything that is not a plain public unicast address: private, loopback, link-local,
 * carrier-grade NAT, benchmarking, multicast, reserved, and IPv6 forms that embed an IPv4
 * address (IPv4-mapped, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo) are judged by that IPv4 address.
 */
export function isPrivateAddress(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6
  try { addr = ipaddr.parse(ip.replace(/^\[|\]$/g, '')) } catch { return true }
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) return isPrivateAddress(v6.toIPv4Address().toString())
    const parts = v6.toByteArray()
    const embedded = (from: number) => ipaddr.fromByteArray(parts.slice(from, from + 4)).toString()
    if (v6.match(ipaddr.parseCIDR('64:ff9b::/96'))) return isPrivateAddress(embedded(12))
    if (v6.match(ipaddr.parseCIDR('2002::/16'))) return isPrivateAddress(embedded(2))
    if (v6.match(ipaddr.parseCIDR('::/96'))) return true // IPv4-compatible (deprecated) and unspecified
    return v6.range() !== 'unicast'
  }
  return addr.range() !== 'unicast'
}

/** Validates a channel URL when the user saves it. Throws with a friendly message. */
export async function validateChannelUrl(raw: string): Promise<string> {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new Error('That is not a valid URL.') }
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) throw new Error('Alert URLs must use https://')
  if (u.username || u.password) throw new Error('Put credentials in the path or query, not before the host.')
  if (raw.length > 500) throw new Error('That URL is too long.')
  await resolvePublic(u.hostname)
  return u.toString()
}

async function resolvePublic(rawHost: string): Promise<string> {
  const host = rawHost.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error(`Could not find ${host}.`) })
  if (!addrs.length) throw new Error(`Could not find ${host}.`)
  if (!allowPrivate() && addrs.some(a => isPrivateAddress(a.address))) throw new Error('Alert URLs must point to a public internet address.')
  return addrs[0].address
}

function body(kind: ChannelKind, e: AlertEvent): { data: string; type: string; extraHeaders: Record<string, string> } {
  const text = `${e.title}\n${e.message}${e.url ? `\n${e.url}` : ''}`
  switch (kind) {
    case 'discord': return { data: JSON.stringify({ content: text.slice(0, 1900) }), type: 'application/json', extraHeaders: {} }
    case 'slack': return { data: JSON.stringify({ text }), type: 'application/json', extraHeaders: {} }
    case 'telegram': return { data: JSON.stringify({ text }), type: 'application/json', extraHeaders: {} }
    case 'ntfy': return {
      data: e.message, type: 'text/plain; charset=utf-8',
      extraHeaders: { Title: e.title.replace(/[^\x20-\x7e]/g, ''), Priority: /HOLD|HANDOVER|NOMINEES/.test(e.event) ? 'urgent' : 'high', ...(e.url ? { Click: e.url } : {}), Tags: 'warning' },
    }
    default: return { data: JSON.stringify(e), type: 'application/json', extraHeaders: {} }
  }
}

/** Sends one alert. Never throws; returns an error string on failure. */
export async function sendToChannel(url: string, e: AlertEvent, secret: string | null): Promise<string | null> {
  try {
    const u = new URL(url)
    const ip = await resolvePublic(u.hostname) // re-checked at send time (DNS may have changed)
    const kind = channelKind(url)
    const { data, type, extraHeaders } = body(kind, e)
    const headers: Record<string, string> = { 'Content-Type': type, 'Content-Length': String(Buffer.byteLength(data)), 'User-Agent': 'busfactor', ...extraHeaders }
    if (kind === 'webhook' && secret) {
      const ts = Math.floor(Date.now() / 1000).toString()
      headers['X-Busfactor-Timestamp'] = ts
      headers['X-Busfactor-Signature'] = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${data}`).digest('hex')
    }
    const fn = u.protocol === 'http:' ? httpRequest : request
    return await new Promise<string | null>(resolve => {
      let done = false
      const finish = (v: string | null) => { if (!done) { done = true; clearTimeout(deadline); resolve(v) } }
      const req = fn({
        host: ip, servername: isIP(u.hostname.replace(/^\[|\]$/g, '')) ? undefined : u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search, method: 'POST', headers: { ...headers, Host: u.host }, timeout: 8000,
      }, res => {
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300
        res.destroy() // we only need the status; never wait for (or buffer) the body
        finish(ok ? null : `HTTP ${res.statusCode}`)
      })
      // Hard deadline for the whole request, not just idle time, so a trickling server cannot hold us.
      const deadline = setTimeout(() => { req.destroy(); finish('timed out') }, 10_000)
      req.on('timeout', () => { req.destroy(); finish('timed out') })
      req.on('error', err => finish(err.message))
      req.end(data)
    })
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
