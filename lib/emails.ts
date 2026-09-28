/**
 * Email templates. Plain English: many recipients are family members, not developers.
 * Every value that came from a user is HTML-escaped.
 */
import { APP_NAME } from './config'
import type { HoldReason } from './engine/stages'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const fmt = (d: Date) =>
  d.toLocaleString('en-GB', {
    timeZone: process.env.DEFAULT_TIMEZONE || 'Europe/London',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })

const RED = '#dc2626', INK = '#111827', GREEN = '#059669', BLUE = '#2563eb'

function wrap(title: string, body: string, accent = BLUE) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.6">
  <div style="border-top:6px solid ${accent};padding:24px 8px">
    <h2 style="margin:0 0 16px 0;color:${accent}">${title}</h2>
    ${body}
    <p style="margin-top:32px;font-size:12px;color:#6b7280">Sent by ${APP_NAME}, a check-in service for people who look after systems on their own. This is an automated message.</p>
  </div></div>`
}

const button = (href: string, label: string, bg = BLUE) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${bg};color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${label}</a></p>`

const privateLink = `<p style="font-size:13px;color:#6b7280">This link is personal to you. Please do not forward it.</p>`

function whyText(owner: string, r: HoldReason) {
  const o = esc(owner)
  return r === 'CONFIRMED' ? `${o}'s chosen contacts have confirmed they are not OK.`
    : r === 'ONE_CONFIRMED_NO_REPLY' ? `One of ${o}'s chosen contacts confirmed they are not OK, and the others did not reply to two emails.`
    : `None of ${o}'s chosen contacts replied to two emails, and ${o} has not responded for several weeks.`
}

const roleText = (role: string) => role === 'BOTH'
  ? 'one of the people we ask "are they OK?" if they stop checking in, and the person who receives their handover instructions if something happens to them'
  : role === 'TRUSTED'
    ? 'the person who receives their handover instructions if something happens to them'
    : 'one of the people we ask "are they OK?" if they stop checking in'

export const Emails = {
  // ------------------------------------------------------------------ account
  verifyEmail(name: string, url: string) {
    return {
      subject: `Confirm your email for ${APP_NAME}`,
      html: wrap('Confirm your email', `<p>Hi ${esc(name)},</p><p>Please confirm your email address to finish setting up your account.</p>
        ${button(url, 'Confirm email')}<p style="font-size:13px;color:#6b7280">If you did not sign up, you can ignore this email.</p>`),
    }
  },
  passwordReset(name: string, url: string) {
    return {
      subject: `Reset your ${APP_NAME} password`,
      html: wrap('Reset your password', `<p>Hi ${esc(name)},</p><p>Someone (hopefully you) asked to reset your password. The link works for one hour.</p>
        ${button(url, 'Choose a new password')}<p style="font-size:13px;color:#6b7280">If this was not you, ignore this email. Your password has not changed.</p>`),
    }
  },
  accountExists(name: string, loginUrl: string, forgotUrl: string) {
    return {
      subject: `Someone tried to sign up to ${APP_NAME} with your email`,
      html: wrap('You already have an account', `<p>Hi ${esc(name)},</p><p>Someone (probably you) tried to create a new account with this email address, but you already have one.</p>
        ${button(loginUrl, 'Log in')}<p>Forgotten your password? <a href="${esc(forgotUrl)}">Reset it here</a>.</p>
        <p style="font-size:13px;color:#6b7280">If this was not you, you can ignore this email.</p>`),
    }
  },
  passwordChanged(name: string) {
    return {
      subject: `Your ${APP_NAME} password was changed`,
      html: wrap('Password changed', `<p>Hi ${esc(name)},</p><p>Your password was just changed and all other sessions were signed out.</p>
        <p>If this was not you, reset your password straight away.</p>`, RED),
    }
  },

  // ------------------------------------------------------------------ nominees
  invite(owner: string, nominee: string, role: string, url: string) {
    return {
      subject: `${owner} has asked you to be one of their emergency contacts`,
      html: wrap(`${esc(owner)} is asking for your help`, `<p>Hi ${esc(nominee)},</p>
        <p>${esc(owner)} uses ${APP_NAME}: they check in every few weeks, and if they ever stop, the people they trust are contacted.
        They have asked you to be <strong>${roleText(role)}</strong>.</p>
        <p>Nothing will happen unless ${esc(owner)} stops checking in. You would only ever hear from us in that case.</p>
        ${button(url, 'Accept or decline')}${privateLink}`),
    }
  },
  inviteAnsweredOwner(nominee: string, accepted: boolean) {
    return {
      subject: `${nominee} ${accepted ? 'accepted' : 'declined'} your ${APP_NAME} invitation`,
      html: wrap(accepted ? 'Invitation accepted' : 'Invitation declined',
        `<p>${esc(nominee)} has ${accepted ? 'accepted' : 'declined'} your invitation.</p>`, accepted ? GREEN : INK),
    }
  },

  // ------------------------------------------------------------------ switch
  reminder(n: 1 | 2, owner: string, daysSince: number, loginUrl: string, checkinUrl: string) {
    const urgent = n === 2
    return {
      subject: urgent ? `⚠️ Second reminder: please check in to ${APP_NAME} now` : `Time for your ${APP_NAME} check-in`,
      html: wrap(urgent ? 'Second reminder: please check in' : 'Time to check in', `<p>Hi ${esc(owner)},</p>
        <p>It has been <strong>${daysSince} days</strong> since you last checked in.</p>
        <p>Press the button, then <strong>"I'm OK"</strong> on the page that opens. That's all.</p>
        ${button(checkinUrl, "I'm OK: check in", urgent ? RED : BLUE)}
        <p style="font-size:13px;color:#6b7280">Or <a href="${esc(loginUrl)}">log in</a> as usual. The button works once and only checks you in.</p>
        ${urgent ? '<p><strong>If you do not check in soon, your contacts will be asked whether you are OK.</strong></p>' : ''}`,
        urgent ? RED : BLUE),
    }
  },
  nomineeAlert(nominee: string, owner: string, daysSince: number, respondUrl: string) {
    return {
      subject: `Please check that ${owner} is OK`,
      html: wrap(`Is ${esc(owner)} OK?`, `<p>Hi ${esc(nominee)},</p>
        <p>${esc(owner)} has not checked in for <strong>${daysSince} days</strong> and has not answered two reminders.</p>
        <p><strong>Please try to contact ${esc(owner)} first</strong> (phone, message or in person), then tell us what you found.</p>
        ${button(respondUrl, `Tell us: is ${esc(owner)} OK?`)}
        <p style="font-size:13px;color:#6b7280">There are two choices: "They're OK" (everything resets) or "They're not OK".
        If you do not reply you will get one reminder; after that we go ahead with ${esc(owner)}'s plan using the answers we have.</p>${privateLink}`),
    }
  },
  nomineeReminder(nominee: string, owner: string, deadline: Date, respondUrl: string) {
    return {
      subject: `Reminder: please check that ${owner} is OK`,
      html: wrap('We still need your answer', `<p>Hi ${esc(nominee)},</p>
        <p>A few days ago we asked you to check whether ${esc(owner)} is OK, and we have not heard from you. ${esc(owner)} has still not checked in.</p>
        <p><strong>Please try to contact them</strong>, then use the button below.</p>
        ${button(respondUrl, `Tell us: is ${esc(owner)} OK?`, RED)}
        <p>If we do not hear from you by <strong>${fmt(deadline)}</strong>, we will go ahead with ${esc(owner)}'s plan.</p>${privateLink}`, RED),
    }
  },
  nomineeReminderOwner(names: string[], deadline: Date, checkinUrl: string) {
    return {
      subject: '🚨 Your contacts have been chased: check in now to stop the handover',
      html: wrap('Your contacts have been chased', `<p>You still have not checked in. ${esc(names.join(', ') || 'Your contacts')} ${names.length === 1 ? 'has' : 'have'} been reminded to check on you.</p>
        <p>If nobody says you are OK by <strong>${fmt(deadline)}</strong>, the handover process starts.</p>
        ${button(checkinUrl, "I'm OK: stop this", RED)}`, RED),
    }
  },
  holdStartedOwner(owner: string, holdEndsAt: Date, trustedNames: string[], checkinUrl: string, reason: HoldReason) {
    const why = reason === 'CONFIRMED' ? 'Your contacts have confirmed you are <strong>not OK</strong>.'
      : reason === 'ONE_CONFIRMED_NO_REPLY' ? 'One contact confirmed you are <strong>not OK</strong> and the others did not reply.'
      : 'None of your contacts replied, and you have not checked in.'
    return {
      subject: '🚨 Your handover has started: check in to cancel',
      html: wrap('Handover started: cancel it if you are OK', `<p>${esc(owner)},</p><p>${why}</p>
        <p>Unless you check in, your handover link will be emailed to <strong>${esc(trustedNames.join(', ') || 'your trusted person')}</strong> on <strong>${fmt(holdEndsAt)}</strong>.</p>
        ${button(checkinUrl, "I'm OK: cancel the handover", RED)}`, RED),
    }
  },
  holdStartedNominee(nominee: string, owner: string, holdEndsAt: Date, reason: HoldReason) {
    return {
      subject: `Update about ${owner}`,
      html: wrap('Thank you', `<p>Hi ${esc(nominee)},</p><p>${whyText(owner, reason)}
        As a safety measure we wait until <strong>${fmt(holdEndsAt)}</strong> in case this is a mistake and ${esc(owner)} can cancel it.</p>
        <p>If you know ${esc(owner)} is OK, please use the link in our earlier email, or ask them to log in.</p>
        <p>After that, the person ${esc(owner)} chose will receive their instructions. You do not need to do anything else.</p>`),
    }
  },
  handover(trusted: string, owner: string, handoverUrl: string | null, reason: HoldReason, sealed: boolean, fallbackContact?: string, personal = false) {
    const body = handoverUrl
      ? `${button(handoverUrl, 'Open the instructions', INK)}
         ${personal ? `<p>${esc(owner)} also left <strong>a personal message for you</strong>. It opens with the passphrase <em>you</em> chose when you accepted their invitation.</p>` : ''}
         ${sealed ? `<p>Some instructions are locked with a passphrase ${esc(owner)} should have given you in advance.</p>` : ''}
         <p style="font-size:13px;color:#6b7280">The link works for 30 days. It stops working if ${esc(owner)} turns out to be OK.</p>${privateLink}`
      : `<p style="background:#fef2f2;border-left:4px solid ${RED};padding:16px">${esc(owner)} did not leave written instructions with us.
         Please contact ${fallbackContact ? esc(fallbackContact) : `${esc(owner)}'s family`}, who may know what ${esc(owner)} wanted.</p>`
    return {
      subject: `Handover instructions from ${owner}`,
      html: wrap('Handover instructions', `<p>Hi ${esc(trusted)},</p>
        <p>${esc(owner)} asked that you receive this message if they became unable to look after things themselves. ${whyText(owner, reason)}
        We are very sorry to be sending it.</p>${body}`, INK),
    }
  },
  accountChanged(name: string, what: string, loginUrl: string) {
    return {
      subject: `${APP_NAME}: a change was made to your switch`,
      html: wrap('A change was made', `<p>Hi ${esc(name)},</p><p>${esc(what)}</p>
        <p>If this was you, there is nothing to do. <strong>If it was not you</strong>, log in, check your settings and change your password now.</p>
        ${button(loginUrl, 'Review my settings', RED)}`, RED),
    }
  },
  notCovered(name: string, missing: string[], url: string) {
    return {
      subject: `⚠️ ${APP_NAME}: your switch is on but cannot hand over`,
      html: wrap('Your switch cannot hand over yet', `<p>Hi ${esc(name)},</p>
        <p>Your switch is on, but if you stopped checking in nothing would reach anyone, because you have:</p>
        <ul>${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <p>Invite someone new (or ask them to accept their invitation) and this will sort itself out.</p>
        ${button(url, 'Choose your people', RED)}`, RED),
    }
  },
  secondFactorFailures(name: string, url: string) {
    return {
      subject: `${APP_NAME}: someone may know your password`,
      html: wrap('Someone may know your password', `<p>Hi ${esc(name)},</p>
        <p>Someone entered your password correctly, then failed the second login step several times. Your second step stopped them.</p>
        <p><strong>Please change your password now.</strong> If this was you fumbling a code, you can ignore this email.</p>
        ${button(url, 'Change my password', RED)}`, RED),
    }
  },
  loginCode(name: string, code: string) {
    return {
      subject: `Your ${APP_NAME} login code: ${code}`,
      html: wrap('Your login code', `<p>Hi ${esc(name)},</p><p>Your code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px;font-family:monospace">${esc(code)}</p>
        <p>It works for 10 minutes. If you did not just try to log in, change your password: someone knows it.</p>`),
    }
  },
  messageNeedsResave(nominee: string) {
    return {
      subject: `Please re-save your personal message for ${nominee}`,
      html: wrap('Your personal message needs saving again', `<p>${esc(nominee)} set up a new passphrase, so the personal message you left for them
        can no longer be opened. Please write it again in Settings: it will be locked to their new key.</p>`, RED),
    }
  },
  handoverSentOwner(trustedNames: string[]) {
    return {
      subject: 'Your handover link has been sent',
      html: wrap('Handover sent', `<p>Your handover link was emailed to ${esc(trustedNames.join(', ') || 'your trusted person')}.</p>
        <p>If you are OK, log in and check in: the link will stop working and everyone will be told it was a false alarm.</p>`, INK),
    }
  },
  falseAlarm(recipient: string, owner: string, whoConfirmed: string) {
    return {
      subject: `All clear: ${owner} is OK`,
      html: wrap(`All clear: ${esc(owner)} is OK`, `<p>Hi ${esc(recipient)},</p>
        <p>${esc(whoConfirmed)} has confirmed that ${esc(owner)} is OK, so the alert has been cancelled and everything has been reset.</p>
        <p>Any links we sent you have stopped working. Thank you for looking out for them.</p>`, GREEN),
    }
  },
  okConfirmedOwner(nominee: string) {
    return {
      subject: `${nominee} confirmed you are OK`,
      html: wrap('Reset by one of your contacts', `<p>${esc(nominee)} confirmed you are OK, so your timers have been reset.</p>
        <p>Remember to check in yourself next time.</p>`, GREEN),
    }
  },
}
