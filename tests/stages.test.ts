import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, MIN_STAGE_GAP_MS, type TickInput } from '../lib/engine/stages'

const DAY = 86_400_000, H = 3_600_000
const t0 = new Date('2026-10-01T12:00:00Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
const base = (o: Partial<TickInput>): TickInput => ({
  now: t0, enabled: true, stage: 'ACTIVE', lastCheckinAt: t0, createdAt: t0, stageChangedAt: t0, pausedUntil: null, holdEndsAt: null,
  reminder1AfterDays: 14, reminder2AfterDays: 19, nomineeAlertAfterDays: 20, requiredConfirmations: 2,
  nomineeReminderHours: 72, nomineeFinalHours: 24, nomineeReminderSentAt: null, notOkCount: 0, ...o,
})
const NA = (o: Partial<TickInput>) => base({ stage: 'NOMINEES_ALERTED', stageChangedAt: at(20 * DAY), ...o })

test('owner reminders', () => {
  assert.equal(decide(base({ enabled: false, now: at(100 * DAY) })).type, 'NONE')
  assert.equal(decide(base({ now: at(13 * DAY) })).type, 'NONE')
  assert.deepEqual(decide(base({ now: at(14 * DAY) })), { type: 'SEND_REMINDER', n: 1, daysSince: 14 })
  assert.equal(decide(base({ stage: 'REMINDER_1', stageChangedAt: at(14 * DAY), now: at(18 * DAY) })).type, 'NONE')
  assert.deepEqual(decide(base({ stage: 'REMINDER_1', stageChangedAt: at(14 * DAY), now: at(19 * DAY) })), { type: 'SEND_REMINDER', n: 2, daysSince: 19 })
  assert.equal(decide(base({ stage: 'REMINDER_2', stageChangedAt: at(19 * DAY), now: at(20 * DAY) })).type, 'ALERT_NOMINEES')
})

test('minimum gap after downtime', () => {
  assert.deepEqual(decide(base({ stage: 'REMINDER_1', stageChangedAt: at(30 * DAY), now: at(30 * DAY + H) })), { type: 'NONE', reason: 'min gap' })
  assert.equal(decide(base({ stage: 'REMINDER_1', stageChangedAt: at(30 * DAY), now: at(30 * DAY + MIN_STAGE_GAP_MS) })).type, 'SEND_REMINDER')
})

test('contact phase: reminder, trust first answer, silence', () => {
  assert.equal(decide(NA({ notOkCount: 1, now: at(20 * DAY + 71 * H) })).type, 'NONE')
  assert.equal(decide(NA({ notOkCount: 1, now: at(20 * DAY + 72 * H) })).type, 'REMIND_NOMINEES')
  assert.equal(decide(NA({ now: at(20 * DAY + 72 * H) })).type, 'REMIND_NOMINEES')
  assert.equal(decide(NA({ notOkCount: 1, nomineeReminderSentAt: at(23 * DAY), now: at(23 * DAY + 23 * H) })).type, 'NONE')
  assert.deepEqual(decide(NA({ notOkCount: 1, nomineeReminderSentAt: at(23 * DAY), now: at(24 * DAY) })), { type: 'START_HOLD', reason: 'ONE_CONFIRMED_NO_REPLY' })
  assert.deepEqual(decide(NA({ nomineeReminderSentAt: at(23 * DAY), now: at(24 * DAY) })), { type: 'START_HOLD', reason: 'NO_REPLIES' })
  assert.deepEqual(decide(NA({ notOkCount: 2, now: at(20 * DAY + H) })), { type: 'START_HOLD', reason: 'CONFIRMED' })
})

test('hold and handover', () => {
  assert.equal(decide(base({ stage: 'HOLD', holdEndsAt: at(22 * DAY), now: at(21 * DAY) })).type, 'NONE')
  assert.equal(decide(base({ stage: 'HOLD', holdEndsAt: at(22 * DAY), now: at(22 * DAY) })).type, 'SEND_HANDOVER')
  assert.equal(decide(base({ stage: 'HANDOVER_SENT', now: at(60 * DAY) })).type, 'NONE')
})

test('pause', () => {
  assert.deepEqual(decide(base({ pausedUntil: at(40 * DAY), now: at(30 * DAY) })), { type: 'NONE', reason: 'paused' })
  assert.equal(decide(base({ pausedUntil: at(30 * DAY), now: at(32 * DAY) })).type, 'NONE')
  assert.deepEqual(decide(base({ pausedUntil: at(30 * DAY), now: at(44 * DAY) })), { type: 'SEND_REMINDER', n: 1, daysSince: 14 })
  // A pause does not freeze an alert that is already with the contacts.
  assert.equal(decide(NA({ pausedUntil: at(40 * DAY), notOkCount: 2, now: at(21 * DAY) })).type, 'START_HOLD')
})
