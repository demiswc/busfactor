import { redirect } from 'next/navigation'

/** Settings now live in the dashboard's steps. Old links still work. */
export default function SettingsPage() {
  redirect('/dashboard?s=people')
}
