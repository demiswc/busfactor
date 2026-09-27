import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { getCurrentUser } from '@/lib/auth'
import { LogoutButton } from '@/components/LogoutButton'

export const metadata: Metadata = {
  title: 'busfactor: a check-in for people who run things alone',
  description: 'Check in every few weeks. If you stop, the people you trust are asked if you are OK, and your handover instructions reach the right person.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-black/10 dark:border-white/10">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-brand" />busfactor
            </Link>
            <div className="flex items-center gap-4 text-sm">
              {user ? (
                <>
                  <Link href="/dashboard" className="hover:text-brand">Dashboard</Link>
                  <Link href="/settings" className="hover:text-brand">Settings</Link>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:text-brand">Log in</Link>
                  <Link href="/signup" className="rounded-lg bg-brand px-3 py-2 font-medium text-white hover:bg-brand-dark">Get started</Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-black/50 dark:text-white/50">
          <div className="flex flex-wrap gap-4 border-t border-black/10 pt-6 dark:border-white/10">
            <span>busfactor</span>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <a href="https://github.com/demiswc/busfactor" className="hover:underline">Source code</a>
          </div>
        </footer>
      </body>
    </html>
  )
}
