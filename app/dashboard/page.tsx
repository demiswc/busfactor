import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import Workspace from '@/components/workspace/Workspace'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  if (!(await getCurrentUser())) redirect('/login?next=/dashboard')
  return <Workspace />
}
