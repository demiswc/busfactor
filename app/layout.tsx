import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'
import { getCurrentUser } from '@/lib/auth'
import { LogoutButton } from '@/components/LogoutButton'
import { appUrl } from '@/lib/config'
import { ReportVitals } from '@/components/ReportVitals'

const TITLE = "busfactor: a dead man's switch for solo developers"
const DESCRIPTION = "Check in every few weeks. If you go quiet, the people you trust are asked if you're OK and your handover reaches the right person. Free and open source."

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: TITLE, template: '%s · busfactor' },
  description: DESCRIPTION,
  applicationName: 'busfactor',
  keywords: ['dead man\'s switch', 'bus factor', 'business continuity', 'digital legacy', 'handover plan', 'solo developer', 'check-in service', 'emergency contacts', 'open source'],
  openGraph: { type: 'website', siteName: 'busfactor', locale: 'en_GB', url: '/', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  appleWebApp: { capable: true, title: 'busfactor', statusBarStyle: 'default' },
}

export const viewport: Viewport = { themeColor: '#0f766e' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ReportVitals />
        <header className="border-b border-black/10 dark:border-white/10">
          <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2 font-semibold tracking-tight">
              <img src="/logo-mark-96.png" alt="" width={30} height={30} className="h-[30px] w-[30px]" />
              <span className="text-lg font-bold tracking-tight"><span className="text-[#0f1d2b] dark:text-white">bus</span><span className="text-[#0e8a7d] dark:text-[#2dd4bf]">factor</span></span>
            </Link>
            <div className="flex items-center gap-4 text-sm">
              {user ? (
                <>
                  <Link href="/dashboard" className="hover:text-brand">Dashboard</Link>
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
        <main className="mx-auto max-w-7xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-black/50 dark:text-white/50">
          <div className="flex flex-wrap gap-4 border-t border-black/10 pt-6 dark:border-white/10">
            <span>busfactor</span>
            <Link href="/#why" className="hover:underline">Why busfactor</Link>
            <Link href="/#how" className="hover:underline">How it works</Link>
            <Link href="/#video" className="hover:underline">Video walkthrough</Link>
            <Link href="/#who" className="hover:underline">Who it&apos;s for</Link>
            <Link href="/#security" className="hover:underline">Security</Link>
            <Link href="/#faq" className="hover:underline">Questions</Link>
            {!user && <Link href="/signup" className="hover:underline">Create an account</Link>}
            {!user && <Link href="/login" className="hover:underline">Log in</Link>}
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <a href="https://github.com/demiswc/busfactor" className="hover:underline">Source code</a>
          </div>
        </footer>
      </body>
    </html>
  )
}
