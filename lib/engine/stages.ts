/**
 * Pure decision logic for a busfactor switch. No database or email here,
 * so every scenario is unit-tested (tests/stages.test.ts).
 *
 *   ACTIVE -> REMINDER_1 -> REMINDER_2 -> NOMINEES_ALERTED -> HOLD -> HANDOVER_SENT
 *
 * A check-in, or any nominee answering "they're OK", returns to ACTIVE.
 *
 * Nominee phase (NOMINEES_ALERTED), while nobody has said "OK":
 *   - enough "not OK" answers (default 2)                      -> HOLD at once
 *   - after nomineeReminderHours (72h) silent nominees are emailed again
 *   - nomineeFinalHours (24h) after that reminder:
 *       at least one "not OK", the rest silent -> answers trusted -> HOLD
 *       nobody answered at all                 -> HOLD
 */

export type Stage = 'ACTIVE' | 'REMINDER_1' | 'REMINDER_2' | 'NOMINEES_ALERTED' | 'HOLD' | 'HANDOVER_SENT'
export type HoldReason = 'CONFIRMED' | 'ONE_CONFIRMED_NO_REPLY' | 'NO_REPLIES'

/** Minimum time between owner-reminder stages, so a server that was down for
 *  days does not fire every email within minutes of coming back. */
export const MIN_STAGE_GAP_MS = 12 * 60 * 60 * 1000

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export interface TickInput {
  now: Date
  enabled: boolean
  stage: Stage
  lastCheckinAt: Date | null
  createdAt: Date
  stageChangedAt: Date
  pausedUntil: Date | null
  holdEndsAt: Date | null
  reminder1AfterDays: number
  reminder2AfterDays: number
  nomineeAlertAfterDays: number
  requiredConfirmations: number
  nomineeReminderHours: number
  nomineeFinalHours: number
  nomineeReminderSentAt: Date | null
  notOkCount: number
}

export type Action =
  | { type: 'NONE'; reason: string }
  | { type: 'SEND_REMINDER'; n: 1 | 2; daysSince: number }
  | { type: 'ALERT_NOMINEES'; daysSince: number }
  | { type: 'REMIND_NOMINEES' }
  | { type: 'START_HOLD'; reason: HoldReason }
  | { type: 'SEND_HANDOVER' }

type ClockInput = Pick<TickInput, 'lastCheckinAt' | 'createdAt' | 'pausedUntil' | 'now'>

/** The moment the check-in clock counts from. A finished pause restarts it. */
export function clockStart(i: ClockInput): Date {
  let base = i.lastCheckinAt ?? i.createdAt
  if (i.pausedUntil && i.pausedUntil <= i.now && base < i.pausedUntil) base = i.pausedUntil
  return base
}

export function daysSince(i: ClockInput): number {
  return Math.floor((i.now.getTime() - clockStart(i).getTime()) / DAY)
}

export function isPaused(i: Pick<TickInput, 'pausedUntil' | 'now'>): boolean {
  return !!i.pausedUntil && i.pausedUntil > i.now
}

export function decide(i: TickInput): Action {
  if (!i.enabled) return { type: 'NONE', reason: 'disabled' }
  if (isPaused(i) && (i.stage === 'ACTIVE' || i.stage === 'REMINDER_1' || i.stage === 'REMINDER_2')) {
    return { type: 'NONE', reason: 'paused' }
  }

  const days = daysSince(i)
  const heldLongEnough = i.now.getTime() - i.stageChangedAt.getTime() >= MIN_STAGE_GAP_MS

  switch (i.stage) {
    case 'ACTIVE':
      return days >= i.reminder1AfterDays ? { type: 'SEND_REMINDER', n: 1, daysSince: days } : { type: 'NONE', reason: 'within period' }
    case 'REMINDER_1':
      if (days < i.reminder2AfterDays) return { type: 'NONE', reason: 'waiting for reminder 2' }
      return heldLongEnough ? { type: 'SEND_REMINDER', n: 2, daysSince: days } : { type: 'NONE', reason: 'min gap' }
    case 'REMINDER_2':
      if (days < i.nomineeAlertAfterDays) return { type: 'NONE', reason: 'waiting to alert nominees' }
      return heldLongEnough ? { type: 'ALERT_NOMINEES', daysSince: days } : { type: 'NONE', reason: 'min gap' }
    case 'NOMINEES_ALERTED':
      if (i.notOkCount >= i.requiredConfirmations) return { type: 'START_HOLD', reason: 'CONFIRMED' }
      if (!i.nomineeReminderSentAt) {
        return i.now.getTime() - i.stageChangedAt.getTime() >= i.nomineeReminderHours * HOUR
          ? { type: 'REMIND_NOMINEES' }
          : { type: 'NONE', reason: 'awaiting nominee answers' }
      }
      if (i.now.getTime() - i.nomineeReminderSentAt.getTime() < i.nomineeFinalHours * HOUR) {
        return { type: 'NONE', reason: 'awaiting answers after reminder' }
      }
      return { type: 'START_HOLD', reason: i.notOkCount > 0 ? 'ONE_CONFIRMED_NO_REPLY' : 'NO_REPLIES' }
    case 'HOLD':
      return i.holdEndsAt && i.now >= i.holdEndsAt ? { type: 'SEND_HANDOVER' } : { type: 'NONE', reason: 'in hold' }
    case 'HANDOVER_SENT':
      return { type: 'NONE', reason: 'handover already sent' }
  }
}

/** Stages at which people other than the owner have been contacted. */
export function othersContacted(stage: Stage): boolean {
  return stage === 'NOMINEES_ALERTED' || stage === 'HOLD' || stage === 'HANDOVER_SENT'
}
