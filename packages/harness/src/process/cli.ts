import { existsSync } from 'node:fs'
import { type Environment, loadEnvironment } from './environment.ts'
import { locate } from './locate.ts'
import { platform } from './platform/index.ts'
import type { Command } from './run.ts'

/** What starting the CLI takes: where it is, and the environment it runs in. */
export interface Launch {
  command: Command
  env: Environment
}

/** The CLI is not on this machine. The message is written for the user. */
export class NotInstalled extends Error {}

interface CliOptions {
  /** The program's name, as typed in a terminal. */
  program: string
  /** The places it is usually installed on this system, for a home folder and an environment. */
  usualLocations(home: string, env: Environment): string[]
  /** What to tell the user when it is not found. */
  notInstalled: string
  /** The command to use in place of the one found: the program, then the arguments put before every call's own. */
  command?: string[] | undefined
  /** The environment to use in place of this process's. */
  env?: Environment | undefined
}

/** The user's own CLI on this machine. It is run as it is, with their sign-in; their credentials are never read. */
export interface Cli {
  /** How to start it. Rejects with `NotInstalled` when it is not on this machine. */
  launch(): Promise<Launch>
  /** The same, looking for the program again instead of trusting where it was last time. Gives nothing when it is not found. */
  find(): Promise<Launch | undefined>
}

export function createCli(options: CliOptions): Cli {
  const [program, ...leading] = options.command ?? []
  const given: Command | undefined = program === undefined ? undefined : { program, leading }
  let found: string | undefined

  async function find(fresh: boolean): Promise<Launch | undefined> {
    const env = await loadEnvironment(options.env)
    if (given) return { command: given, env }
    // The user may have removed or moved the program since it was found.
    if (fresh || found === undefined || !existsSync(found)) found = locate(options.program, env, options.usualLocations(platform.home(env), env))
    return found === undefined ? undefined : { command: { program: found, leading: [] }, env }
  }

  return {
    find: () => find(true),
    launch: async () => {
      const launch = await find(false)
      if (!launch) throw new NotInstalled(options.notInstalled)
      return launch
    }
  }
}
