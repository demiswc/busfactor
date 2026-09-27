import { lookupInvite } from '@/lib/engine/service'
import { Card, H1, Muted, Notice } from '@/components/ui'
import { InviteButtons } from '@/components/NomineeActions'

export const dynamic = 'force-dynamic'

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = '' } = await searchParams
  const inv = await lookupInvite(t)
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {!inv.valid ? <Notice tone="warn">{inv.reason}</Notice> : (
        <>
          <H1>{inv.ownerName} is asking for your help</H1>
          <Card className="space-y-4">
            <p>Hi {inv.nomineeName},</p>
            <p>
              {inv.ownerName} checks in with us every few weeks. If they ever stop,{' '}
              {inv.role === 'TRUSTED'
                ? <>you would receive a private link to the instructions they have left: what to do, who to call, where things are.</>
                : <>we would email you to ask whether they are OK. You would try to reach them, then press one of two buttons.</>}
            </p>
            <Muted>You would only ever hear from us if {inv.ownerName} stops checking in. No account needed. You can ask to be removed at any time by telling {inv.ownerName}.</Muted>
            {inv.status === 'ACCEPTED' && !inv.needsKey
              ? <Notice tone="ok">You have already accepted. Thank you.</Notice>
              : <InviteButtons ownerName={inv.ownerName} role={inv.role} needsKey={inv.needsKey} alreadyAccepted={inv.status === 'ACCEPTED'} />}
          </Card>
        </>
      )}
    </div>
  )
}
