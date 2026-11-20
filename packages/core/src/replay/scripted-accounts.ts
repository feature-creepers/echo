import type {
  AccountFailure,
  AccountPart,
  AccountProvider,
  Accounts,
  CalendarEvent,
  EventRange,
  Keeping,
  MailArrival,
  MailMessage,
  MailSearch,
  MailSummary,
  SignedIn
} from '../ports/accounts.ts'
import type { Signal } from '../ports/harness.ts'

/** Two providers, one this build can sign in to and one it cannot. */
export const SCRIPTED_PROVIDERS: AccountProvider[] = [
  { id: 'mailbox', label: 'Mailbox', offered: true, notes: ['Reads as you allow.'] },
  { id: 'elsewhere', label: 'Elsewhere', offered: false, problem: 'This build has no sign-in for Elsewhere.', notes: [] }
]

/** A sign-in waiting for the person, as the test plays them. */
interface Signing {
  request: { account: string; provider: string; parts: readonly AccountPart[] }
  signal: Signal
  finish(outcome: SignedIn | AccountFailure): void
}

/** An `Accounts` port played by a test: sign-ins end when the test says, and what is held is what the test sets. */
export interface ScriptedAccounts extends Accounts {
  /** The sign-in under way, if any. */
  signing(): Signing | undefined
  /** The accounts this computer holds a sign-in for. */
  held: Set<string>
  disconnected: string[]
  forgotten: string[]
  /** What each account's calendar holds, or why it cannot be read: a promise the test settles, for a slow one. */
  calendars: Map<string, CalendarEvent[] | AccountFailure | Promise<CalendarEvent[]>>
  /** The spans read, in order. */
  ranges: EventRange[]
  /** What each account's mailbox answers a search, or why it cannot be read. */
  mailboxes: Map<string, MailSummary[] | AccountFailure>
  /** The searches made, in order. */
  searches: MailSearch[]
  /** The mails read whole, by account and identifier: `<account>/<id>`. */
  messages: Map<string, MailMessage>
  /** The mails arrived in each account's inbox since its last look, or why it cannot be looked at. */
  inboxes: Map<string, MailArrival[] | AccountFailure>
  /** The looks at an inbox, in order: the account, and the cursor it was asked from. */
  looks: { account: string; cursor: string | undefined }[]
}

export function scriptedAccounts(keeping: Keeping = { kept: true }): ScriptedAccounts {
  let signing: Signing | undefined
  const held = new Set<string>()
  const disconnected: string[] = []
  const forgotten: string[] = []
  const calendars = new Map<string, CalendarEvent[] | AccountFailure | Promise<CalendarEvent[]>>()
  const ranges: EventRange[] = []
  const mailboxes = new Map<string, MailSummary[] | AccountFailure>()
  const searches: MailSearch[] = []
  const messages = new Map<string, MailMessage>()
  const inboxes = new Map<string, MailArrival[] | AccountFailure>()
  const looks: { account: string; cursor: string | undefined }[] = []
  return {
    providers: () => SCRIPTED_PROVIDERS,
    keeping: async () => keeping,
    connect: (request, signal) =>
      new Promise((resolve) => {
        const finish = (outcome: SignedIn | AccountFailure) => {
          if (signing?.request !== request) return
          signing = undefined
          if (outcome.ok) held.add(request.account)
          resolve(outcome)
        }
        signing = { request, signal, finish }
        signal.addEventListener('abort', () => finish({ ok: false, reason: 'The sign-in was cancelled.' }))
      }),
    async disconnect(account) {
      disconnected.push(account)
      held.delete(account)
    },
    async forget(account) {
      forgotten.push(account)
      held.delete(account)
    },
    holds: async (account) => held.has(account),
    async events(account, range) {
      ranges.push(range)
      const kept = await (calendars.get(account) ?? [])
      return Array.isArray(kept) ? { ok: true, events: kept } : kept
    },
    async searchMail(account, search) {
      searches.push(search)
      const kept = mailboxes.get(account) ?? []
      return Array.isArray(kept) ? { ok: true, mails: kept.slice(0, search.limit) } : kept
    },
    async readMail(account, id) {
      const mail = messages.get(`${account}/${id}`)
      return mail ? { ok: true, mail } : { ok: false, reason: `There is no mail ${id}.` }
    },
    async arrived(account, cursor) {
      looks.push({ account, cursor })
      const waiting = inboxes.get(account) ?? []
      if (!Array.isArray(waiting)) return waiting
      inboxes.set(account, [])
      // A first look takes the cursor of now: what arrived before is not told.
      return { ok: true, cursor: `${account}@${looks.length}`, mails: cursor === undefined ? [] : waiting }
    },
    signing: () => signing,
    held,
    disconnected,
    forgotten,
    calendars,
    ranges,
    mailboxes,
    searches,
    messages,
    inboxes,
    looks
  }
}
