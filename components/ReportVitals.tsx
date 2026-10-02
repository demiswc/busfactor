'use client'
import { useReportWebVitals } from 'next/web-vitals'

/** Sends how long this page took to load (Web Vitals) so the operator can see if the site is slow. Numbers only. */
export function ReportVitals() {
  useReportWebVitals(m => {
    if (!['TTFB', 'FCP', 'LCP', 'INP', 'CLS'].includes(m.name)) return
    const payload = JSON.stringify({ name: m.name, value: m.value, page: window.location.pathname })
    fetch('/api/rum', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
  })
  return null
}
