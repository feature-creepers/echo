import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { Environment } from '../environment.ts'
import type { Invocation, Platform } from './platform.ts'

/** Windows reads a variable's name without regard to case, and a copied environment keeps the case it was written in: `Path`, mostly. */
const keyOf = (env: Environment, name: string) => Object.keys(env).find((candidate) => candidate.toUpperCase() === name)

function variable(env: Environment, name: string): string | undefined {
  const key = keyOf(env, name)
  return key === undefined ? undefined : env[key]
}

/** The kinds of file a program can be started from: a program, or a script for the command interpreter. */
const STARTABLE = new Set(['.com', '.exe', '.bat', '.cmd'])

/**
 * The extensions Windows runs without being told, in its order, of the files that can be started here: PATHEXT also
 * names scripts for other hosts (`.js`, `.vbs`, `.py`), which `invocation` cannot start.
 */
function extensions(env: Environment): string[] {
  return (variable(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.toLowerCase())
    .filter((extension) => STARTABLE.has(extension))
}

/**
 * One argument as the command interpreter must read it, then the program it starts. Inside quotes the interpreter
 * takes every character as written except the quote itself, which is doubled. The program reads a backslash before
 * a quote as escaping it, so the backslashes before a quote, or before the closing one, are doubled too. A `%NAME%`
 * is still replaced when NAME is a variable: nothing on a command line prevents that.
 */
export function quoteArgument(argument: string): string {
  if (argument === '') return '""'
  if (!/[\s"&|<>^()%!,;=]/.test(argument)) return argument
  return `"${argument.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, '$1$1')}"`
}

/**
 * A CLI installed with npm is a `.cmd` script, and Node refuses to start a script directly: it goes through
 * the command interpreter, which splits a command line by its own rules. Hence the quoting.
 */
function invocation(file: string, args: string[]): Invocation {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, shell: false }
  return { file: `"${file}"`, args: args.map(quoteArgument), shell: true }
}

export const win32: Platform = {
  home: (env) => variable(env, 'USERPROFILE') || homedir(),
  fileNames: (program, env) => extensions(env).map((extension) => program + extension),
  searchPath: (env) => variable(env, 'PATH') ?? '',
  withSearchPath: (env, path) => ({ ...env, [keyOf(env, 'PATH') ?? 'Path']: path }),
  // A program started from the desktop has the same PATH as one started from a terminal.
  loginPath: async () => undefined,
  usualFolders: () => [],
  invocation,
  // Stopping a script stops the command interpreter and leaves the program it started running: the whole tree is stopped.
  terminate: (child) => {
    if (child.pid === undefined) return
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => void child.kill())
  }
}
