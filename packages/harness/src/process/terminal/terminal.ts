import { spawn } from 'node:child_process'
import type { Environment } from '../environment.ts'

/** A command to run in a terminal window the user can see and type in. */
export interface TerminalRequest {
  /** The program, then its arguments. */
  command: string[]
  /** The window's title, where the system shows one. */
  title: string
  /** Variables the command needs and a new terminal would not have. */
  variables: Record<string, string>
  /** The environment of this process's own children, in which the terminal program is looked for and started. */
  env: Environment
}

/** Opens a terminal window that runs the command. Rejects, with a message for the user, when none could be opened. */
export type OpenTerminal = (request: TerminalRequest) => Promise<void>

/** What to start so that a terminal window opens. */
export interface TerminalLaunch {
  file: string
  args: string[]
  /** The arguments are a command line already written the way the system's command interpreter reads it. */
  verbatim?: true
}

/** Start the terminal and let it live its own life: it must stay open after this process ends. */
export function launch(plan: TerminalLaunch, env: Environment): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.args, { env, detached: true, stdio: 'ignore', windowsVerbatimArguments: plan.verbatim ?? false })
    child.once('error', (error) => reject(new Error(`The terminal could not be opened: ${error.message}`)))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
