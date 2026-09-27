import { Card, H1, Notice } from '@/components/ui'

export default function Terms() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <H1>Terms</H1>
      <Notice tone="warn">Draft. Have this reviewed before offering the service publicly.</Notice>
      <Card className="space-y-4 text-sm leading-relaxed">
        <p>busfactor is provided as-is, on a best-efforts basis. Email can be delayed, filtered as spam or fail. Servers can go down.</p>
        <p><strong>Do not rely on busfactor as your only plan.</strong> It is not a will, a legal document or an emergency service. Keep a written
          plan with the people you trust, and a will with a solicitor.</p>
        <p>You are responsible for what you put in your instructions and for inviting only people who have agreed to help you.</p>
        <p>We may suspend accounts used to harass people. You can delete your account at any time.</p>
        <p>To the extent permitted by law, the operator is not liable for loss caused by a message being sent, delayed or not sent.</p>
      </Card>
    </div>
  )
}
