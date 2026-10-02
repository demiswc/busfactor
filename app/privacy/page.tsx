import type { Metadata } from 'next'
import { Card, H1 } from '@/components/ui'

export const metadata: Metadata = { title: 'Privacy', alternates: { canonical: '/privacy' } }

export default function Privacy() {
  const operator = process.env.OPERATOR_NAME || 'the operator of this site'
  const contact = process.env.OPERATOR_EMAIL || 'the site operator'
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <H1>Privacy</H1>
      <Card className="space-y-4 text-sm leading-relaxed">
        <p>This service is run by {operator}. Contact: {contact}.</p>
        <p><strong>What we store.</strong> Your name, email and a hashed password; your timer settings and check-in history; the names and email
          addresses of the people you invite; their answers; and your handover instructions.</p>
        <p><strong>Your instructions and messages.</strong> Sealed instructions and personal messages are encrypted in your browser and we cannot read them.
          Instructions saved without a passphrase (where this site allows it) are encrypted on our server with a key held by the operator.</p>
        <p><strong>Encryption at rest.</strong> Names, email addresses, contact details and activity details are stored encrypted, so a copy of the database alone reveals none of them.</p>
        <p><strong>Your contacts.</strong> We email your contacts only to invite them, and later only if you stop checking in. They can decline,
          and declined contacts are never contacted again unless you invite them again.</p>
        <p><strong>Why.</strong> We process this data to provide the service you asked for (contract), and your contacts&apos; details on the basis
          of legitimate interests, with their consent obtained through the invitation.</p>
        <p><strong>Usage statistics.</strong> We count things like sign-ups, check-ins and emails sent, and your browser reports how long pages took to load. These are stored as plain numbers with no name, email, account or IP address attached, and load times are deleted after 30 days. No third-party analytics or tracking is used.</p>
        <p><strong>Retention.</strong> Deleting your account removes all of this immediately. Server logs are kept for up to 30 days.</p>
        <p><strong>Sharing.</strong> We do not sell data or use it for advertising. Emails are sent through our mail provider.</p>
        <p><strong>Your rights.</strong> You can access, correct or delete your data at any time from Settings, or by contacting us.</p>
      </Card>
    </div>
  )
}
