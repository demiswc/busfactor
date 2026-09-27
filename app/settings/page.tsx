import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { H1 } from '@/components/ui'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  if (!(await getCurrentUser())) redirect('/login?next=/settings')
  return (
    <div className="space-y-6">
      <H1>Settings</H1>
      <SettingsClient />
    </div>
  )
}
