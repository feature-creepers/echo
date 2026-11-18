import type { Access } from '@repo/protocol'
import type { ComputerUse } from '../ports/harness.ts'
import type { CommandReading } from './commands.ts'

/**
 * Whether a use within what was granted runs at once or is asked first (docs/SPEC.md, section 12.2). Uses
 * beyond it, or reaching a place never reached, were refused before this.
 *
 * | Level   | Runs without asking                                                  | Asks                                     |
 * | ------- | -------------------------------------------------------------------- | ---------------------------------------- |
 * | `ask`   | Reading, and commands that only read                                 | Every change, every other command        |
 * | `trust` | The same, and changes to files where they may be changed             | Every other command                      |
 * | `auto`  | Everything, commands naming only places that may be changed included | Commands that destroy or publish, deleting files |
 *
 * Two guardrails stand above the level, each a setting that is on by default. With `askDestroying`, what
 * destroys is asked at every level and never covered by a yes for the session. With `askPublishing`, what
 * publishes, putting something before others beyond this computer (a push, a release, a post), is asked at
 * every level too; a yes for the session covers it, for those who push often. The person may turn either off:
 * what it guarded then follows the level like any other change.
 */
export type Decision =
  | { run: true; because: 'read-only' | 'level' | 'session' }
  /** Asked first. `session` when a yes for the session may be offered: never for what destroys while it is guarded. */
  | { run: false; destructive: boolean; session: boolean }

/** What the policy reads of the access: the level and the two guardrails above it. */
export type Policy = Pick<Access, 'approvals' | 'askDestroying' | 'askPublishing'>

export function decide(use: ComputerUse, policy: Policy, reading: CommandReading | undefined, coveredForSession: boolean): Decision {
  const level = policy.approvals
  if (use.action === 'read') return { run: true, because: 'read-only' }
  if (use.action === 'delete') {
    if (policy.askDestroying) return { run: false, destructive: true, session: false }
    return changeFile(level, coveredForSession)
  }
  if (use.action === 'run') {
    if (!reading) return { run: false, destructive: false, session: false }
    if (reading.readOnly) return { run: true, because: 'read-only' }
    if (reading.destructive && policy.askDestroying) return { run: false, destructive: true, session: false }
    if (reading.publishes && policy.askPublishing) {
      return coveredForSession ? { run: true, because: 'session' } : { run: false, destructive: false, session: reading.keys.length > 0 }
    }
    // A command can change what it names: without asking, only where things may be changed.
    if (level === 'auto' && use.reach === 'write') return { run: true, because: 'level' }
    if (coveredForSession) return { run: true, because: 'session' }
    return { run: false, destructive: reading.destructive, session: reading.keys.length > 0 }
  }
  // A file created or changed: the adapter already refused one where it may only be read.
  return changeFile(level, coveredForSession)
}

function changeFile(level: Access['approvals'], coveredForSession: boolean): Decision {
  if (level === 'trust' || level === 'auto') return { run: true, because: 'level' }
  if (coveredForSession) return { run: true, because: 'session' }
  return { run: false, destructive: false, session: true }
}
