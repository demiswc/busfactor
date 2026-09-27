import { lookupRespond } from '@/lib/engine/service'
import { Card, H1, Muted, Notice } from '@/components/ui'
import { RespondButtons } from '@/components/NomineeActions'

export const dynamic = 'force-dynamic'

export default async function RespondPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = '' } = await searchParams
  const r = await lookupRespond(t)
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {!r.valid ? <Notice tone="info">{r.reason}</Notice> : (
        <>
          <H1>Is {r.ownerName} OK?</H1>
          <Card className="space-y-4">
            <p>Hi {r.nomineeName}. {r.ownerName} has stopped checking in and has not answered our reminders.</p>
            <p><strong>Please try to reach {r.ownerName} first</strong> by phone, message or in person, then tell us what you found.</p>
            <RespondButtons ownerName={r.ownerName} />
            <Muted>“{r.ownerName} is OK” cancels everything straight away. “Not OK” is only acted on when confirmed, and a safety wait follows during which {r.ownerName} can still cancel.</Muted>
          </Card>
        </>
      )}
    </div>
  )
}
