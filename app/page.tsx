import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { appUrl } from '@/lib/config'

export const metadata: Metadata = { alternates: { canonical: '/' } }

const steps = [
  { t: 'You check in', d: 'Every few weeks you log in and press "I\'m OK". Miss it and we remind you, twice.' },
  { t: 'Your people are asked', d: 'Still nothing? The people you chose get an email: "Is Alex OK?" with two buttons.' },
  { t: 'We wait, carefully', d: 'Silent contacts get a reminder. Two "not OK" answers, or no answer at all, start a safety wait you can cancel.' },
  { t: 'The right person takes over', d: 'Your trusted person gets a private link to your handover notes: where the keys are, who to call, what to keep running.' },
]

const others = [
  { t: 'Small business owners', d: 'The accounts, the suppliers, payroll, the till and the website. Who to call so the doors stay open.' },
  { t: 'Freelancers and creatives', d: 'Work in progress for clients, unpublished manuscripts, music or photos, and where the originals live.' },
  { t: 'Researchers and writers', d: 'Years of data, drafts and notes, where the backups are, and who should have them.' },
  { t: 'The family admin', d: 'Bank accounts, bills, insurance, passwords, the will, and the things only you know how to do.' },
  { t: 'Anyone keeping secrets safe', d: 'Crypto wallets, a safe, a deposit box, private archives: how to reach them, only when it is truly needed.' },
]

const faqs = [
  { q: 'Who is this for?', a: 'It was built for solo developers, freelancers and one-person businesses: anyone whose clients, systems and income depend on knowledge that lives only in their head. But it works for anyone who is the only one holding the keys to something important, from a family\'s finances to a lifetime of creative work.' },
  { q: 'What should my handover say?', a: 'Whatever the person taking over will need: where the passwords and keys are, who to call first, what must keep running, what bills to pay and what can be switched off. There are ready-made templates for developers, small businesses, creative work and household affairs to start from.' },
  { q: 'How many people do I need?', a: 'At least one confirmer (asked whether you are OK) and one trusted person (who receives the handover), and one person can be both. Two confirmers is better: then one mistaken "not OK" cannot start a handover on its own. Your switch will not turn on until the minimum have accepted.' },
  { q: 'What if I am just on holiday?', a: 'Pause it for up to 90 days. And any one of your contacts answering "they\'re OK" resets everything straight away.' },
  { q: 'Can you read my instructions?', a: 'No. Personal messages are locked in your browser to your trusted person\'s own key, which only their passphrase opens, so nobody has to share a passphrase in advance. General instructions are sealed with a passphrase of your choice. We only ever store the locked versions, and names and emails are encrypted too.' },
  { q: 'How is my account protected?', a: 'Passkeys and security keys like YubiKey, authenticator apps or email codes. Turning your switch off or changing your contacts needs your password again, and you get an email about every such change.' },
  { q: 'What stops a false alarm?', a: 'Two reminders to you, contacts who must try to reach you first, a reminder to anyone silent, then a safety wait (48 hours by default) during which one click from you cancels it all. Links stop working the moment you check in.' },
  { q: 'Do my contacts need an account?', a: 'No. They accept an invitation by email and only ever hear from us if you stop checking in.' },
  { q: 'Is it open source? Can I self-host?', a: 'Yes, both. It is MIT-licensed: read exactly what it does, or run your own copy with one install script on any Ubuntu or Debian server.' },
]

export default async function Home() {
  if (await getCurrentUser().catch(() => null)) redirect('/dashboard')
  const url = appUrl()
  // Structured data for search engines: what busfactor is, and the questions below.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication', '@id': `${url}/#app`, name: 'busfactor', url, applicationCategory: 'SecurityApplication', operatingSystem: 'Any (web browser)',
        description: "A dead man's switch for solo developers and anyone who holds the keys: check in every few weeks, and if you go quiet the people you trust are asked if you're OK and your handover reaches the right person.",
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' }, isAccessibleForFree: true, license: 'https://opensource.org/licenses/MIT',
        image: `${url}/opengraph-image.png`,
      },
      { '@type': 'WebSite', '@id': `${url}/#site`, name: 'busfactor', url },
      { '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  }
  return (
    <div className="space-y-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="max-w-3xl">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">For solo developers, and anyone who holds the keys</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          You&apos;re the only one with the keys. What happens if you go quiet?
        </h1>
        <p className="mt-6 text-lg text-black/70 dark:text-white/70">
          Servers, domains, DNS, client sites, the Stripe account, the repos, the hardware keys: when you run it all yourself,
          your bus factor is one. busfactor is a dead man&apos;s switch for developers. Check in every few weeks. If you ever stop,
          the people you trust are asked whether you&apos;re OK, and your handover notes reach the one person who can keep
          things running. Nothing leaves until it has been confirmed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-lg bg-brand px-5 py-3 font-medium text-white hover:bg-brand-dark">Set up your switch</Link>
          <a href="#how" className="rounded-lg border border-black/15 px-5 py-3 font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">How it works</a>
        </div>
        </div>
        <img src="/logo-mark.png" alt="busfactor logo: a letter b with a keyhole" width={256} height={256} className="mx-auto hidden h-64 w-64 lg:block" />
      </section>

      <section id="how">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.t} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
              <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">{i + 1}</span>
              <h3 className="mb-1 font-semibold">{s.t}</h3>
              <p className="text-sm text-black/65 dark:text-white/65">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="who">
        <h2 className="mb-2 text-2xl font-semibold tracking-tight">Not a developer? It&apos;s for you too.</h2>
        <p className="mb-8 max-w-3xl text-black/70 dark:text-white/70">
          Anyone can have a bus factor of one. If there is something only you know how to find, open or keep running, busfactor makes
          sure the right person can take over, and only when it is truly needed.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map(o => (
            <li key={o.t} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
              <h3 className="mb-1 font-semibold">{o.t}</h3>
              <p className="text-sm text-black/65 dark:text-white/65">{o.d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="security" className="grid gap-6 rounded-2xl bg-ink p-8 text-white sm:grid-cols-3 dark:bg-white/5">
        <div>
          <h3 className="mb-2 font-semibold">Only they can open it</h3>
          <p className="text-sm text-white/70">Locked in your browser to your trusted person&apos;s own key. Only their passphrase opens it: not us, not even you.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Links, not secrets</h3>
          <p className="text-sm text-white/70">Your instructions are never emailed. The handover is a private link that dies the moment you check in.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Consent first</h3>
          <p className="text-sm text-white/70">Contacts accept an invitation before they count, so nobody gets a frightening email out of the blue.</p>
        </div>
      </section>

      <section id="faq" className="max-w-3xl">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">Questions</h2>
        <div className="divide-y divide-black/10 rounded-2xl border border-black/10 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/5">
          {faqs.map(f => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold hover:text-brand [&::-webkit-details-marker]:hidden">
                {f.q}
                <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-black/40 transition-transform group-open:rotate-180 dark:text-white/40" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8l5 5 5-5" /></svg>
              </summary>
              <p className="px-5 pb-5 text-black/70 dark:text-white/70">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
