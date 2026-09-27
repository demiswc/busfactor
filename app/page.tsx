import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

const steps = [
  { t: 'You check in', d: 'Every few weeks you log in and press "I\'m OK". Miss it and we remind you, twice.' },
  { t: 'Your people are asked', d: 'Still nothing? The people you chose get an email: "Is Alex OK?" with two buttons.' },
  { t: 'We wait, carefully', d: 'Silent contacts get a reminder. Two "not OK" answers, or no answer at all, start a safety wait you can cancel.' },
  { t: 'The right person takes over', d: 'Your trusted person gets a private link to your handover notes: where the keys are, who to call, what to keep running.' },
]

const faqs = [
  { q: 'Who is this for?', a: 'Solo developers, freelancers, indie hackers and one-person agencies: anyone whose clients, servers and income depend on knowledge that lives only in their head.' },
  { q: 'What should my handover say?', a: 'Where the password manager emergency kit is, which domains and certificates renew when, who hosts what, which clients to call first, how to pause billing, and what can safely be switched off. There is a developer template to start from.' },
  { q: 'What if I am just on holiday?', a: 'Pause it for up to 90 days. And any one of your contacts answering "they\'re OK" resets everything straight away.' },
  { q: 'Can you read my instructions?', a: 'No. Personal messages are locked in your browser to your trusted person\'s own key, which only their passphrase opens, so nobody has to share a passphrase in advance. General instructions are sealed with a passphrase of your choice. We only ever store the locked versions, and names and emails are encrypted too.' },
  { q: 'How is my account protected?', a: 'Passkeys and security keys like YubiKey, authenticator apps or email codes. Turning your switch off or changing your contacts needs your password again, and you get an email about every such change.' },
  { q: 'What stops a false alarm?', a: 'Two reminders to you, contacts who must try to reach you first, a reminder to anyone silent, then a safety wait (48 hours by default) during which one click from you cancels it all. Links stop working the moment you check in.' },
  { q: 'Do my contacts need an account?', a: 'No. They accept an invitation by email and only ever hear from us if you stop checking in.' },
  { q: 'Is it open source? Can I self-host?', a: 'Yes, both. It is MIT-licensed: read exactly what it does, or run your own copy with one install script on any Ubuntu or Debian server.' },
]

export default async function Home() {
  if (await getCurrentUser().catch(() => null)) redirect('/dashboard')
  return (
    <div className="space-y-20">
      <section className="max-w-3xl pt-6">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">For solo developers</p>
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

      <section className="grid gap-6 rounded-2xl bg-ink p-8 text-white sm:grid-cols-3 dark:bg-white/5">
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

      <section className="max-w-3xl">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">Questions</h2>
        <dl className="space-y-5">
          {faqs.map(f => (
            <div key={f.q}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-black/70 dark:text-white/70">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
