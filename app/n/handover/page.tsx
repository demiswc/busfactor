import { lookupHandover } from '@/lib/engine/service'
import { Card, H1, Notice } from '@/components/ui'
import { HandoverViewer } from '@/components/NomineeActions'

export const dynamic = 'force-dynamic'

export default async function HandoverPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = '' } = await searchParams
  const h = await lookupHandover(t)
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!h.valid ? <Notice tone="info">{h.reason}</Notice> : (
        <>
          <H1>Instructions from {h.ownerName}</H1>
          <Card className="space-y-4">
            <p>Hi {h.trustedName}. {h.ownerName} asked that you receive these if they became unable to look after things. We are very sorry.</p>
            <HandoverViewer ownerName={h.ownerName} />
          </Card>
        </>
      )}
    </div>
  )
}
