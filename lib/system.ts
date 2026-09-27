/** Instance health: when the scheduler last ran, and an optional external heartbeat (healthchecks.io, Uptime Kuma…). */
import { db } from './db'

const LAST_TICK = 'lastTickAt'
export const STALE_AFTER_MS = 30 * 60 * 1000

export async function recordTick(now = new Date()) {
  await db.systemState.upsert({ where: { key: LAST_TICK }, update: { value: now.toISOString() }, create: { key: LAST_TICK, value: now.toISOString() } })
  const ping = process.env.HEALTHCHECK_PING_URL
  if (ping) {
    // Operator-configured URL, so no SSRF guard needed. Failure must not break the tick.
    await fetch(ping, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {})
  }
}

export async function lastTickAt(): Promise<Date | null> {
  const row = await db.systemState.findUnique({ where: { key: LAST_TICK } })
  return row ? new Date(row.value) : null
}

export async function schedulerHealthy(now = Date.now()) {
  const t = await lastTickAt()
  return { lastTickAt: t, healthy: !!t && now - t.getTime() < STALE_AFTER_MS }
}
