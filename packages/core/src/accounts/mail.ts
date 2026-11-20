import type { MailAddress, MailMessage, MailSummary } from '../ports/accounts.ts'

/**
 * Mail as a model reads it (docs/SPEC.md, section 12.1, `mail`): the mails a search found, the latest first, and a
 * mail read whole. Everything in them was written by others.
 */

/** The most mails a search gives, and how many by default. */
export const MAX_MAILS = 25
export const DEFAULT_MAILS = 10
/** How much of a mail's first words a search gives. */
const SNIPPET_LENGTH = 200
/** How much of a mail's text is given. */
export const MAIL_TEXT_LENGTH = 20_000

/** A mail found, and the account it is in. */
export interface FoundMail extends MailSummary {
  account: string
}

/** "Bank <no-reply@bank.example>", or the address alone. */
export const addressWords = (who: MailAddress) => (who.name && who.name !== who.address ? `${who.name} <${who.address}>` : who.address)

/** "Bank", or the address when there is no name: how a person names a sender. */
export const senderName = (who: MailAddress) => who.name || who.address

const formats = new Map<string, Intl.DateTimeFormat>()
/** "Thursday 3 December 2026, 09:12" on the person's clock. */
export function dateWords(instant: string, zone: string): string {
  let format = formats.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    formats.set(zone, format)
  }
  return format
    .format(Date.parse(instant))
    .replace(' at ', ', ')
    .replace(/^(\w+), /, '$1 ')
}

/** "3 December", a local date as a person says it, for what a search covered. */
export function dayWords(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(Date.UTC(year, month - 1, date))
}

/** Words a stranger wrote, on one line, so a line break cannot start what reads as another mail. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The mails a search found, the latest first, for a model. */
export function mailLines(mails: readonly FoundMail[], zone: string): string {
  return mails
    .map((mail) => {
      const files =
        mail.attachments === 'some'
          ? ' · with attachments'
          : mail.attachments > 0
            ? ` · ${mail.attachments} attachment${mail.attachments === 1 ? '' : 's'}`
            : ''
      const snippet = oneLine(mail.snippet)
      return [
        `- id ${mail.id} in ${mail.account}`,
        `  ${dateWords(mail.date, zone)} · from ${oneLine(addressWords(mail.from))} · “${oneLine(mail.subject)}”${mail.unread ? ' · unread' : ''}${files}`,
        ...(snippet ? [`  ${snippet.length > SNIPPET_LENGTH ? `${snippet.slice(0, SNIPPET_LENGTH)}…` : snippet}`] : [])
      ].join('\n')
    })
    .join('\n')
}

/** A size in words: "220 KB". */
function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A mail's headers, for the fence's lines: who, when, what about. */
export function mailHeaders(mail: MailMessage, zone: string): Record<string, string> {
  return {
    From: addressWords(mail.from),
    ...(mail.to.length > 0 ? { To: mail.to.map(addressWords).join(', ') } : {}),
    ...(mail.cc.length > 0 ? { Cc: mail.cc.map(addressWords).join(', ') } : {}),
    Date: dateWords(mail.date, zone),
    Subject: oneLine(mail.subject)
  }
}

/** A mail's text, cut to its first 20,000 characters, then the files it carries by name, kind and size. */
export function mailBody(mail: MailMessage): { text: string; cut: boolean } {
  const cut = mail.text.length > MAIL_TEXT_LENGTH
  const files = mail.attachments.map((file) => `- ${file.name} (${file.kind}, ${sizeWords(file.size)})`)
  const text = [
    cut ? mail.text.slice(0, MAIL_TEXT_LENGTH) : mail.text || '(no text)',
    ...(files.length > 0 ? ['', 'Attachments, not downloaded:', ...files] : [])
  ].join('\n')
  return { text, cut }
}
