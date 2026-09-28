/** Plain-English labels for the activity log. */
export const EVENT_LABELS: Record<string, string> = {
  ACCOUNT_CREATED: 'Account created', EMAIL_VERIFIED: 'Email confirmed', LOGIN: 'Logged in',
  PASSWORD_CHANGED: 'Password changed', PASSWORD_RESET: 'Password reset',
  SETTINGS_UPDATED: 'Settings changed', INSTRUCTIONS_UPDATED: 'Handover instructions saved',
  NOMINEE_INVITED: 'Invitation sent', NOMINEE_ACCEPTED: 'Invitation accepted', NOMINEE_DECLINED: 'Invitation declined',
  NOMINEE_KEY_SET: 'Contact set up their passphrase', NOMINEE_REMOVED: 'Contact removed',
  MESSAGE_SAVED: 'Personal message sealed', MESSAGE_DELETED: 'Personal message deleted',
  CHECK_IN: 'Checked in', REMINDER_1_SENT: 'First reminder sent', REMINDER_2_SENT: 'Second reminder sent',
  NOMINEES_ALERTED: 'Contacts asked if you are OK', NOMINEES_REMINDED: 'Silent contacts reminded',
  NOMINEE_SAYS_OK: 'A contact said you are OK', NOMINEE_SAYS_NOT_OK: 'A contact said you are not OK',
  HOLD_STARTED: 'Safety wait started', HANDOVER_SENT: 'Handover link sent', HANDOVER_VIEWED: 'Handover opened',
  ALL_CLEAR_SENT: 'All-clear sent to contacts', NO_NOMINEES: 'No contacts to ask', PUSH_DEVICE_ADDED: 'Phone added for reminders', PUSH_DEVICE_DELETED: 'Phone removed from reminders', PUSH_DEVICE_REMOVED: 'Phone stopped receiving reminders', PUSH_TEST: 'Test notification sent', NOT_COVERED: 'Warning sent: switch on but nobody to ask or hand over to',
  TEST_EMAILS_SENT: 'Test emails sent', EMAIL_FAILED: 'Email could not be sent', CHANNEL_FAILED: 'Alert channel failed',
  CHANNELS_UPDATED: 'Alert channels changed', API_TOKEN_CREATED: 'Check-in token created', API_TOKEN_REVOKED: 'Check-in token revoked',
  TOTP_ENABLED: 'Authenticator app on', TOTP_DISABLED: 'Authenticator app off', EMAIL_CODES_ENABLED: 'Email codes on',
  EMAIL_CODES_DISABLED: 'Email codes off', PASSKEY_ADDED: 'Passkey added', PASSKEY_REMOVED: 'Passkey removed',
  RECOVERY_CODES_REGENERATED: 'New recovery codes made', SECOND_FACTOR_FAILURES: 'Repeated failed second-step logins', DECRYPT_FAILED: 'Could not decrypt instructions',
}
export const eventLabel = (t: string) => EVENT_LABELS[t] ?? t
