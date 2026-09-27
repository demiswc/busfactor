import type { ReactNode, InputHTMLAttributes, ButtonHTMLAttributes } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 ${className}`}>{children}</section>
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{children}</h1>
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold">{children}</h2>
}

export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm text-black/60 dark:text-white/60 ${className}`}>{children}</p>
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }
export function Button({ variant = 'primary', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'border border-black/15 bg-white hover:bg-black/5 dark:border-white/15 dark:bg-transparent dark:hover:bg-white/10',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-brand hover:underline',
  }[variant]
  return <button {...p} className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-black/55 dark:text-white/55">{hint}</span>}
    </label>
  )
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/15 dark:bg-black/20 ${p.className ?? ''}`} />
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const t = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  }[tone]
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${t}`}>{children}</div>
}
