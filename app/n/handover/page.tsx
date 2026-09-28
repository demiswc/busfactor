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
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">What to do now</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Take a breath. Nothing has to happen in the next hour: systems and accounts keep running on their own.</li>
              <li>Open the instructions above. {h.ownerName} will have given you the passphrase, or you chose your own when you accepted.</li>
              <li>If they point to a continuity plan (a document, a USB drive, a folder, a password manager), find it and start with its first-24-hours section.</li>
              <li>Tell the people they list that you are looking after things for now. You don&apos;t have to have all the answers yet.</li>
              <li>If {h.ownerName} turns out to be fine, they only need to log in: this link then stops working.</li>
            </ol>
          </Card>
        </>
      )}
    </div>
  )
}
