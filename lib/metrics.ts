/**
 * Operator statistics: how many people use this site, how much email it sends, how fast pages load.
 *
 * Privacy: everything here is a count or a timing. No names, emails, user ids or IP addresses are
 * stored or shown, so the stats page cannot expose a client even to the operator.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from './db'
import { emailHash } from './crypto'
import { schedulerHealthy } from './system'

const DAY = 24 * 60 * 60 * 1000
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)

/** Adds to today's counter. Never throws: stats must not break real work. */
export async function bump(key: string, n = 1) {
  if (!n) return
  const day = dayKey()
  try {
    await db.metric.upsert({ where: { day_key: { day, key } }, update: { count: { increment: n } }, create: { day, key, count: n } })
  } catch {
    // Two first-of-the-day bumps can race on create; the second one retries as an update.
    await db.metric.update({ where: { day_key: { day, key } }, data: { count: { increment: n } } }).catch(() => {})
  }
}

// ------------------------------------------------------------------ page-load timings (Web Vitals)

export const PERF_METRICS = ['TTFB', 'FCP', 'LCP', 'INP', 'CLS'] as const
const PAGES = ['/', '/dashboard', '/login', '/signup', '/c', '/n/invite', '/n/respond', '/n/handover', '/privacy', '/terms']

export function pageGroup(path: unknown): string {
  const p = typeof path === 'string' ? path.split('?')[0].replace(/\/+$/, '') || '/' : ''
  return PAGES.includes(p) ? p : 'other'
}

export async function recordPerf(metric: unknown, value: unknown, page: unknown) {
  if (typeof metric !== 'string' || !(PERF_METRICS as readonly string[]).includes(metric)) return
  const v = Number(value)
  if (!Number.isFinite(v) || v < 0) return
  const stored = Math.round(metric === 'CLS' ? v * 1000 : v)
  if (stored > 120_000) return // nonsense
  await db.perfSample.create({ data: { day: dayKey(), metric, page: pageGroup(page), value: stored } }).catch(() => {})
}

// ------------------------------------------------------------------ who may see the stats

/** OPERATOR_ADMIN_EMAILS: comma-separated account emails allowed to open /stats. Unset = nobody. */
export function isOperatorAdmin(user: { email: string } | null | undefined): boolean {
  if (!user?.email) return false
  const list = (process.env.OPERATOR_ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean)
  return list.some(e => emailHash(e) === emailHash(user.email))
}

/** The stats page also needs the account to have a second login step, so a password alone never opens it. */
export async function hasSecondFactor(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, emailOtpEnabled: true, _count: { select: { passkeys: true } } } })
  return !!u && (!!u.totpEnabledAt || u.emailOtpEnabled || u._count.passkeys > 0)
}

// ------------------------------------------------------------------ the numbers

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null)

function appVersion() {
  let version = 'unknown', commit: string | null = null
  try { version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version } catch {}
  try {
    const head = readFileSync(join(process.cwd(), '.git', 'HEAD'), 'utf8').trim()
    commit = head.startsWith('ref: ') ? readFileSync(join(process.cwd(), '.git', head.slice(5)), 'utf8').trim() : head
    commit = commit.slice(0, 7)
  } catch {}
  return { version, commit }
}

export async function collectStats(now = new Date()) {
  const since = (days: number) => new Date(now.getTime() - days * DAY)
  const distinctUsers = async (type: string, days: number) =>
    (await db.event.groupBy({ by: ['userId'], where: { type, createdAt: { gte: since(days) } } })).length

  const dbStart = Date.now()
  await db.$queryRawUnsafe('SELECT 1')
  const dbPingMs = Date.now() - dbStart

  const [
    usersTotal, usersVerified, new1, new7, new30, login7, login30, checkin30, with2faRows, pushUsers,
    switchesOn, paused, stageRows, instrRows, messages, contactRows, schedule,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { emailVerifiedAt: { not: null } } }),
    db.user.count({ where: { createdAt: { gte: since(1) } } }),
    db.user.count({ where: { createdAt: { gte: since(7) } } }),
    db.user.count({ where: { createdAt: { gte: since(30) } } }),
    distinctUsers('LOGIN', 7),
    distinctUsers('LOGIN', 30),
    distinctUsers('CHECK_IN', 30),
    db.user.findMany({ where: { OR: [{ totpEnabledAt: { not: null } }, { emailOtpEnabled: true }, { passkeys: { some: {} } }] }, select: { id: true } }),
    db.pushDevice.groupBy({ by: ['userId'] }),
    db.switch.count({ where: { enabled: true } }),
    db.switch.count({ where: { enabled: true, pausedUntil: { gt: now } } }),
    db.switch.groupBy({ by: ['stage'], where: { enabled: true }, _count: { _all: true } }),
    db.switch.groupBy({ by: ['instructionsMode'], _count: { _all: true } }),
    db.message.count(),
    db.nominee.groupBy({ by: ['role', 'status'], _count: { _all: true } }),
    schedulerHealthy(),
  ])

  // Daily counters for the last 30 days.
  const days = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now.getTime() - (29 - i) * DAY)))
  const metricRows = await db.metric.findMany({ where: { day: { gte: days[0] } } })
  const series = (key: string) => days.map(d => metricRows.find(r => r.day === d && r.key === key)?.count ?? 0)
  const sum = (key: string, lastDays: number) => series(key).slice(-lastDays).reduce((a, b) => a + b, 0)

  // Page-load timings, last 7 days.
  const perfRows = await db.perfSample.findMany({ where: { day: { gte: dayKey(since(6)) } }, select: { metric: true, page: true, value: true } })
  const perf = PERF_METRICS.map(m => {
    const v = perfRows.filter(r => r.metric === m).map(r => r.value).sort((a, b) => a - b)
    return { metric: m, samples: v.length, p50: pct(v, 50), p75: pct(v, 75), p95: pct(v, 95) }
  })
  const lcpByPage = Array.from(new Set(perfRows.filter(r => r.metric === 'LCP').map(r => r.page))).map(page => {
    const v = perfRows.filter(r => r.metric === 'LCP' && r.page === page).map(r => r.value).sort((a, b) => a - b)
    return { page, samples: v.length, p75: pct(v, 75) }
  }).sort((a, b) => b.samples - a.samples)

  const ticks7 = sum('tick_runs', 7)
  const contacts = (role: string, status: string) => contactRows.find(r => r.role === role && r.status === status)?._count._all ?? 0
  const mem = process.memoryUsage()

  return {
    generatedAt: now.toISOString(),
    users: {
      total: usersTotal, verified: usersVerified, new24h: new1, new7d: new7, new30d: new30,
      loggedIn7d: login7, loggedIn30d: login30, checkedIn30d: checkin30,
      with2fa: with2faRows.length, withPhoneReminders: pushUsers.length, deleted30d: sum('account_deleted', 30),
    },
    switches: {
      on: switchesOn, paused,
      byStage: Object.fromEntries(stageRows.map(r => [r.stage, r._count._all])),
      instructions: Object.fromEntries(instrRows.map(r => [r.instructionsMode, r._count._all])),
      personalMessages: messages,
    },
    contacts: {
      confirmersAccepted: contacts('CONFIRMER', 'ACCEPTED'), trustedAccepted: contacts('TRUSTED', 'ACCEPTED'),
      pending: contacts('CONFIRMER', 'PENDING') + contacts('TRUSTED', 'PENDING'),
      declined: contacts('CONFIRMER', 'DECLINED') + contacts('TRUSTED', 'DECLINED'),
    },
    email: {
      sent24h: sum('email_sent', 1), sent7d: sum('email_sent', 7), sent30d: sum('email_sent', 30),
      failed7d: sum('email_failed', 7), failed30d: sum('email_failed', 30),
    },
    push: { sent30d: sum('push_sent', 30), failed30d: sum('push_failed', 30) },
    escalations30d: {
      reminders: sum('reminder_sent', 30), contactsAsked: sum('contacts_asked', 30),
      holdsStarted: sum('hold_started', 30), handoversSent: sum('handover_sent', 30),
    },
    daily: {
      days,
      signups: series('signup'), logins: series('login'), checkins: series('checkin'),
      emailsSent: series('email_sent'), emailsFailed: series('email_failed'), pushesSent: series('push_sent'),
    },
    performance: { perf, lcpByPage },
    server: {
      schedulerHealthy: schedule.healthy, lastTickAt: schedule.lastTickAt,
      avgTickMs7d: ticks7 ? Math.round(sum('tick_ms', 7) / ticks7) : null, ticks7d: ticks7,
      dbPingMs, uptimeHours: Math.round(process.uptime() / 360) / 10,
      memoryMb: Math.round(mem.rss / 1048576), nodeVersion: process.version, ...appVersion(),
    },
  }
}

export type Stats = Awaited<ReturnType<typeof collectStats>>

/** Old samples and counters are removed so the stats never grow without limit. */
export async function pruneMetrics(now = new Date()) {
  await db.perfSample.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 31 * DAY) } } }).catch(() => {})
  await db.metric.deleteMany({ where: { day: { lt: dayKey(new Date(now.getTime() - 400 * DAY)) } } }).catch(() => {})
}
