import { execFile } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { posix as path } from 'node:path'
import type { Environment } from '../environment.ts'
import type { Platform } from './platform.ts'

/** How long the user's shell has to print its PATH. A shell that asks a question at start-up never answers. */
const LOGIN_SHELL_TIMEOUT_MS = 5000

/** Marks the PATH in what the shell prints, since a login shell may greet the user before and after. */
const MARK = '__SEARCH_PATH__'

/** Reads the PATH out of what the shell printed. */
export function readMarkedPath(output: string): string | undefined {
  const found = output.match(new RegExp(`${MARK}(.*?)${MARK}`, 's'))?.[1]
  return found ? found : undefined
}

/**
 * macOS and Linux. A program started from the desktop gets the PATH of the desktop session, not the one the
 * user's shell builds from their profile files. The shell is asked for it, as a login and interactive shell,
 * because users extend PATH in either kind of file.
 */
function loginPath(env: Environment): Promise<string | undefined> {
  const shell = env.SHELL || userShell() || '/bin/sh'
  return new Promise((resolve) => {
    const child = execFile(shell, ['-ilc', `printf "${MARK}%s${MARK}" "$PATH"`], { env, timeout: LOGIN_SHELL_TIMEOUT_MS }, (error, stdout) =>
      resolve(error ? undefined : readMarkedPath(stdout))
    )
    // Nothing to type: a shell that waits for input reads the end of it and goes on.
    child.stdin?.end()
  })
}

function userShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined
  } catch {
    return undefined // The user has no entry in the system's list of accounts, as in some containers.
  }
}

export const unix: Platform = {
  home: (env) => env.HOME || homedir(),
  fileNames: (program) => [program],
  searchPath: (env) => env.PATH ?? '',
  withSearchPath: (env, path) => ({ ...env, PATH: path }),
  loginPath,
  usualFolders: (home) => ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin')],
  invocation: (file, args) => ({ file, args, shell: false }),
  terminate: (child) => void child.kill()
}
