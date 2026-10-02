import nodemailer, { type Transporter } from 'nodemailer'
import { bump } from './metrics'

/**
 * Outgoing email via SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS or SMTP_PASS_B64, SMTP_FROM).
 * SMTP_PASS_B64 (base64) avoids .env quoting problems with passwords containing $, #, quotes or spaces.
 * In development without SMTP_HOST, emails are printed to the console instead.
 */
let transporter: Transporter | null = null

function smtpPassword(): string {
  if (process.env.SMTP_PASS_B64) return Buffer.from(process.env.SMTP_PASS_B64, 'base64').toString('utf8')
  return process.env.SMTP_PASS || ''
}

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465)
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: smtpPassword() } : undefined,
      tls: process.env.SMTP_TLS_SERVERNAME ? { servername: process.env.SMTP_TLS_SERVERNAME } : undefined,
    })
  }
  return transporter
}

export interface Mail { to: string; subject: string; html: string }
export type MailSender = (m: Mail) => Promise<{ ok: boolean; error?: string }>

const smtpSender: MailSender = async ({ to, subject, html }) => {
  const t = getTransporter()
  if (!t) {
    if (process.env.NODE_ENV === 'production') return { ok: false, error: 'SMTP is not configured' }
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`)
    return { ok: true }
  }
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html })
    return { ok: true }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[mail] send failed:', error)
    return { ok: false, error }
  }
}

let sender: MailSender = smtpSender

/** Tests swap the sender for an in-memory outbox. */
export function setMailSender(s: MailSender | null) { sender = s ?? smtpSender }

export async function sendMail(m: Mail) {
  const r = await sender(m)
  await bump(r.ok ? 'email_sent' : 'email_failed')
  return r
}
