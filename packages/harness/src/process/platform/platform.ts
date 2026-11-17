import type { ChildProcess } from 'node:child_process'
import type { Environment } from '../environment.ts'

/** What `spawn` must be given so that a program starts with exactly the arguments meant. */
export interface Invocation {
  file: string
  args: string[]
  /** The file is a script that only the system's command interpreter can run. */
  shell: boolean
}

/** What finding and starting a program takes, where systems differ. */
export interface Platform {
  /** The user's home folder, as the environment says it, else as the system does. */
  home(env: Environment): string
  /** The names a program's file can have in a folder, in the order to try them. */
  fileNames(program: string, env: Environment): string[]
  /** The folders searched for programs, as one string in the system's own form. */
  searchPath(env: Environment): string
  /** The same environment with other folders to search. */
  withSearchPath(env: Environment, path: string): Environment
  /** The search path the user has in a terminal, where a program started from the desktop is not given it. */
  loginPath(env: Environment): Promise<string | undefined>
  /** Folders where CLIs are commonly installed and that a search path may lack. */
  usualFolders(home: string): string[]
  invocation(file: string, args: string[]): Invocation
  /** Stop a program that did not stop when asked, with the programs it started. */
  terminate(child: ChildProcess): void
}
