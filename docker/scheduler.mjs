// Calls the busfactor scheduler every 5 minutes (the docker-compose "scheduler" service).
const url = process.env.TICK_URL || 'http://app:3000/api/cron/tick'
const secret = process.env.CRON_SECRET || ''
const everyMs = Number(process.env.TICK_EVERY_SECONDS || 300) * 1000
if (secret.length < 24) { console.error('CRON_SECRET is missing or too short'); process.exit(1) }

async function tick() {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(120_000) })
    const body = await r.text()
    console.log(new Date().toISOString(), r.status, body.slice(0, 200))
  } catch (e) {
    console.error(new Date().toISOString(), 'tick failed:', e.message)
  }
}
setTimeout(tick, 30_000)
setInterval(tick, everyMs)
