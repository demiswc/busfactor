/**
 * Prints the operator stats on the server, no browser needed:  npm run stats
 * Counts only: no names, emails or addresses.
 */
import 'dotenv/config'
import { collectStats } from '../lib/metrics'
import { db } from '../lib/db'

collectStats()
  .then(s => {
    const lcp = s.performance.perf.find(p => p.metric === 'LCP')
    const lines = [
      `busfactor stats  ${s.generatedAt}  v${s.server.version}${s.server.commit ? ` (${s.server.commit})` : ''}`,
      '',
      `Users            ${s.users.total} (${s.users.verified} confirmed)   new: ${s.users.new24h} today, ${s.users.new7d} this week, ${s.users.new30d} in 30 days`,
      `Active           ${s.users.loggedIn7d} logged in this week, ${s.users.checkedIn30d} checked in (30 days)`,
      `Security         ${s.users.with2fa} with a second login step, ${s.users.withPhoneReminders} with phone reminders`,
      `Switches on      ${s.switches.on} (${s.switches.paused} paused)   ${Object.entries(s.switches.byStage).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      `Escalations 30d  ${s.escalations30d.reminders} reminders, ${s.escalations30d.contactsAsked} contacts asked, ${s.escalations30d.handoversSent} handovers`,
      `Email            ${s.email.sent24h} today, ${s.email.sent7d} this week, ${s.email.sent30d} in 30 days; failed ${s.email.failed7d} this week`,
      `Page load (LCP)  p75 ${lcp?.p75 ?? '—'} ms from ${lcp?.samples ?? 0} samples this week`,
      `Scheduler        ${s.server.schedulerHealthy ? 'running' : 'NOT RUNNING'}, last run ${s.server.lastTickAt ?? 'never'}, avg ${s.server.avgTickMs7d ?? '—'} ms`,
      `Database         ${s.server.dbPingMs} ms`,
    ]
    console.log(process.argv.includes('--json') ? JSON.stringify(s, null, 2) : lines.join('\n'))
  })
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
