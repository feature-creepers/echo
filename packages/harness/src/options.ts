import type { Log, Role } from '@repo/core'
import type { Environment } from './process/environment.ts'

/** What an adapter needs to drive its CLI on this machine. */
export interface HarnessOptions {
  /**
   * A folder the adapter owns. Its sessions run with it as their working folder, and the files a session
   * hands to the CLI (its instructions, the address of the tool server) are written there and removed when
   * the session closes. Created when missing. It must hold nothing else: a CLI reads what is around it.
   */
  folder: string
  log: Log
  /** The model a role runs on, where the adapter's own choice is not wanted. */
  models?: Partial<Record<Role, string>>
  /**
   * The command that starts the CLI, in place of the program found on this machine: the program, then the
   * arguments put before the adapter's own.
   */
  command?: string[]
  /** The environment the CLI starts from, in place of this process's with the search path of the user's terminal. */
  env?: Environment
}
