import { sameAddress } from '../accounts/accounts.ts'
import { stopping } from '../accounts/stopping.ts'
import type { AccountFailure, MailArrival } from '../ports/accounts.ts'
import type { Timers } from '../ports/clock.ts'
import type { Signal } from '../ports/harness.ts'

/**
 * Jobs that ring when a mail arrives (docs/SPEC.md, section 7.10): "tell me when the landlord's mail arrives". Every
 * two minutes, each account a job watches is asked what arrived since it was last asked. Its first look takes only
 * the cursor of now, so mail that arrived while the app was closed rings nothing. What one look finds is one ring
 * for each job it matches; the cursors are kept in memory only.
 */

/** How often the inboxes are looked at. */
export const MAIL_LOOK_MS = 2 * 60_000

/** How many mails of each account are remembered as told, so a mail Graph reports again for a change rings once. */
const TOLD_KEPT = 500

/** A job that rings on mail, as the watch needs it. */
export interface MailJob {
  job: string
  /** The address of the account it watches; left out, every account giving its mail. */
  account?: string | undefined
  /** Words of the sender's address or name. */
  from?: string | undefined
  /** Words the subject holds, every one. */
  subject?: string | undefined
}

/** A mail that arrived, and the address of the account it arrived in. */
export interface ArrivedMail extends MailArrival {
  account: string
}

/** What the accounts give to watch mail. */
export interface MailWatching {
  /** The ready accounts giving their mail. */
  accounts(): { id: string; address: string }[]
  arrived(account: string, cursor: string | undefined, signal: Signal): Promise<{ ok: true; cursor: string; mails: MailArrival[] } | AccountFailure>
  /** The provider refused an account's sign-in: the person signs in again. */
  signInAgain(account: string): void
}

interface MailWatchOptions extends MailWatching {
  timers: Timers
  /** Mails arrived that a job looks for: it rings, naming them. */
  ring(job: string, mails: readonly ArrivedMail[]): void
  problem(message: string): void
}

interface MailWatch {
  /** The jobs to watch for now: the inboxes are looked at while there is one. */
  follow(jobs: readonly MailJob[]): void
  close(): void
}

/** Lower case, accents set aside: how words are compared. */
const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Whether a mail, arrived in an account, is one a job looks for: never one the account sent itself. */
function matchesMail(job: MailJob, mail: ArrivedMail): boolean {
  if (job.account !== undefined && !sameAddress(job.account, mail.account)) return false
  if (sameAddress(mail.from.address, mail.account)) return false
  if (job.from !== undefined) {
    const sender = folded(job.from.trim())
    if (!folded(mail.from.address).includes(sender) && !folded(mail.from.name ?? '').includes(sender)) return false
  }
  const subject = folded(mail.subject)
  return (job.subject ?? '').split(/\s+/).every((word) => subject.includes(folded(word)))
}

export function createMailWatch(options: MailWatchOptions): MailWatch {
  let jobs: readonly MailJob[] = []
  const cursors = new Map<string, string>()
  const told = new Map<string, string[]>()
  let cancel: (() => void) | undefined
  let looking = false

  /** The accounts the jobs watch now. */
  const watched = () => options.accounts().filter((account) => jobs.some((job) => job.account === undefined || sameAddress(job.account, account.address)))

  const look = async () => {
    if (looking) return
    looking = true
    const accounts = watched()
    // An account no longer watched starts again from now when it is.
    for (const id of [...cursors.keys()]) if (!accounts.some((account) => account.id === id)) cursors.delete(id)
    const { signal } = stopping()
    const arrived: ArrivedMail[] = []
    try {
      await Promise.all(
        accounts.map(async (account) => {
          const answer = await options.arrived(account.id, cursors.get(account.id), signal)
          if (!answer.ok) {
            if (answer.signIn) options.signInAgain(account.id)
            else options.problem(`The mail of ${account.address} could not be looked at: ${answer.reason}`)
            return
          }
          cursors.set(account.id, answer.cursor)
          const before = told.get(account.id) ?? []
          const fresh = answer.mails.filter((mail) => !before.includes(mail.id))
          told.set(account.id, [...before, ...fresh.map((mail) => mail.id)].slice(-TOLD_KEPT))
          arrived.push(...fresh.map((mail) => ({ ...mail, account: account.address })))
        })
      )
    } catch (error) {
      options.problem(`The mail could not be looked at: ${error instanceof Error ? error.message : String(error)}`)
      return
    } finally {
      looking = false
    }
    for (const job of jobs) {
      const matching = arrived.filter((mail) => matchesMail(job, mail))
      if (matching.length > 0) options.ring(job.job, matching)
    }
  }

  const arm = () => {
    cancel = options.timers.after(MAIL_LOOK_MS, () => {
      arm()
      void look()
    })
  }

  return {
    follow(next) {
      jobs = next
      if (jobs.length === 0) {
        cancel?.()
        cancel = undefined
        cursors.clear()
        return
      }
      if (cancel) return
      arm()
      void look()
    },
    close() {
      cancel?.()
      cancel = undefined
    }
  }
}
