import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { Environment } from '../environment.ts'
import type { Invocation, Platform } from './platform.ts'

/** Windows reads a variable's name without regard to case, and a copied environment keeps the case it was written in: `Path`, mostly. */
function variable(env: Environment, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/** The extensions Windows runs without being told, in its order. */
function extensions(env: Environment): string[] {
  return (variable(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((extension) => extension.toLowerCase())
}

/**
 * One argument as the command interpreter must read it. Inside quotes it takes every character as written
 * except the quote itself, which is doubled. A `%NAME%` is still replaced when NAME is a variable: nothing
 * on a command line prevents that.
 */
export function quoteArgument(argument: string): string {
  if (argument === '') return '""'
  return /[\s"&|<>^()%!,;=]/.test(argument) ? `"${argument.replace(/"/g, '""')}"` : argument
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
  withSearchPath: (env, path) => {
    const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === 'PATH') ?? 'Path'
    return { ...env, [key]: path }
  },
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
