'use client'
import { api } from '@/lib/client'

export function LogoutButton() {
  return (
    <button className="hover:text-brand" onClick={async () => { await api('/api/auth/logout'); window.location.href = '/' }}>
      Log out
    </button>
  )
}
