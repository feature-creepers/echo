import type { AccountPart, AccountProvider } from '@repo/protocol'
import type { Signal } from './harness.ts'

/** What an account gives to read, and a provider as the Accounts page offers it (`@repo/protocol`). */
export type { AccountPart, AccountProvider }

/**
 * The person's accounts at their providers (docs/SPEC.md, section 12.1, `calendar` and `mail`): signing in, and
 * reading what they granted. The adapter holds the sign-ins, in the vault of the computer it runs on: the core never
 * handles a token. It names an account by its own identifier, and a provider by the identifier the adapter gives it.
 *
 * A method never rejects for what a provider answers: it resolves with why not, in words for the person or a model.
 */
export interface Accounts {
  /** The providers this build knows, each with whether it can sign in to it and why not. */
  providers(): AccountProvider[]
  /** Whether sign-ins outlive the app on this computer, and why not. */
  keeping(): Promise<Keeping>
  /**
   * Sign in, in the system's browser, for the core's account identifier and the parts asked. Resolves once the person
   * is done, the sign-in gives up, or `signal` aborts it, with the address, the name and the parts granted, or why not.
   */
  connect(request: { account: string; provider: string; parts: readonly AccountPart[] }, signal: Signal): Promise<SignedIn | AccountFailure>
  /** Forget an account's sign-in on this computer, and revoke it at the provider where the provider allows it. */
  disconnect(account: string): Promise<void>
  /**
   * Forget an account's sign-in on this computer without revoking it: the same account was signed in again under
   * another identifier, and revoking would end that one too.
   */
  forget(account: string): Promise<void>
  /** Whether this computer holds a sign-in for the account. */
  holds(account: string): Promise<boolean>
  /** The events of every calendar the person shows in the account that meet a span of time, cancelled ones left out. */
  events(account: string, range: EventRange, signal: Signal): Promise<{ ok: true; events: CalendarEvent[] } | AccountFailure>
  /** The mails of the account that match a search, the latest first. */
  searchMail(account: string, search: MailSearch, signal: Signal): Promise<{ ok: true; mails: MailSummary[] } | AccountFailure>
  /** One mail of the account, whole: its text, and its attachments by name, never downloaded. */
  readMail(account: string, id: string, signal: Signal): Promise<{ ok: true; mail: MailMessage } | AccountFailure>
  /**
   * The mails that arrived in the account's inbox since `cursor`, and the cursor to ask from next time. With no
   * cursor, only the cursor of now: what arrived before is not told. A cursor the provider no longer knows is
   * replaced by the one of now, and the mails of the gap are not told either.
   */
  arrived(account: string, cursor: string | undefined, signal: Signal): Promise<{ ok: true; cursor: string; mails: MailArrival[] } | AccountFailure>
}

/** A mail that arrived in an inbox. */
export interface MailArrival {
  id: string
  from: MailAddress
  subject: string
}

/**
 * A search of a mailbox: words, a sender, and dates (YYYY-MM-DD, `after` included, `before` not), at least one of
 * them, and how many mails at most. The adapter quotes what it is given, so nothing is read as the provider's syntax.
 */
export interface MailSearch {
  words?: string | undefined
  from?: string | undefined
  after?: string | undefined
  before?: string | undefined
  limit: number
}

/** Who sent or received a mail. */
export interface MailAddress {
  name?: string | undefined
  address: string
}

/** A mail found by a search. Others wrote it: the core fences it before a model reads it. */
export interface MailSummary {
  /** How the provider knows it: what reads it whole. */
  id: string
  /** When it was received: an instant in ISO 8601. */
  date: string
  from: MailAddress
  subject: string
  /** Its first words, as the provider gives them. */
  snippet: string
  unread: boolean
  /** How many files it carries, or `some` when the provider only says that it carries some. */
  attachments: number | 'some'
}

/** A mail, read whole. */
export interface MailMessage {
  id: string
  date: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  /** Its text: the plain part, or its HTML made text. */
  text: string
  attachments: MailAttachment[]
}

/** A file a mail carries, by name: never downloaded. */
export interface MailAttachment {
  name: string
  /** Its media type: "application/pdf". */
  kind: string
  /** Its size in bytes. */
  size: number
}

/** A span of time to read: two instants, in ISO 8601, and the person's time zone, which a provider may answer in. */
export interface EventRange {
  from: string
  until: string
  zone: string
}

/** An event of a calendar, as the provider gave it. Others wrote it: the core fences it before a model reads it. */
export interface CalendarEvent {
  /** The calendar's name. */
  calendar: string
  title: string
  place?: string | undefined
  description?: string | undefined
  /** All day, `start` is its first date and `end` the day after its last (YYYY-MM-DD); otherwise both are instants in ISO 8601. */
  allDay: boolean
  start: string
  end: string
  /** The person declined it. */
  declined: boolean
}

/** Whether sign-ins outlive the app here: when not, they last until it quits, and `reason` says why. */
export type Keeping = { kept: true } | { kept: false; reason: string }

/** A sign-in that worked: who it is, and what the person granted. */
export interface SignedIn {
  ok: true
  address: string
  name?: string | undefined
  parts: AccountPart[]
}

/** Why something could not be done. `signIn` when the provider refused the sign-in: the person must sign in again. */
export interface AccountFailure {
  ok: false
  reason: string
  signIn?: true | undefined
}
