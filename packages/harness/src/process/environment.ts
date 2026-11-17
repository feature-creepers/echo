import { delimiter } from 'node:path'
import { platform } from './platform/index.ts'

/** The variables a program is started with. */
export type Environment = Record<string, string | undefined>

/**
 * Variables that an agent program sets for the programs it starts, and that say "you are running inside me".
 * A CLI that inherits them believes it is a part of that outer session: it may refuse to start, or attach
 * itself to it. This happens when the app is started from a terminal that an agent drives.
 */
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_.*|AI_AGENT)$/i

/** The variables of that family a user sets on purpose, to say where their account is and how it is reached. */
const KEPT = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'])

/** The same environment, without what a surrounding agent session put in it. */
export function withoutAgentSession(env: Environment): Environment {
  const clean: Environment = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SESSION_MARKERS.test(name) && !KEPT.has(name.toUpperCase())) continue
    clean[name] = value
  }
  return clean
}

let loaded: Promise<Environment> | undefined

/**
 * The environment the CLIs are started with.
 *
 * Given one, it is used as it is, cleaned. Left out, it is this process's, with the PATH the user has in a
 * terminal: an app started from the desktop on macOS or Linux is not given that PATH, so a CLI installed
 * under the user's home would not be found, nor the programs it starts itself. The user's shell is asked
 * once, and the answer serves every adapter for as long as the process lives.
 */
export function loadEnvironment(given?: Environment): Promise<Environment> {
  if (given) return Promise.resolve(withoutAgentSession(given))
  loaded ??= withLoginPath(withoutAgentSession(process.env))
  return loaded
}

async function withLoginPath(env: Environment): Promise<Environment> {
  const login = await platform.loginPath(env)
  const folders = (login ?? platform.searchPath(env)).split(delimiter).filter(Boolean)
  for (const folder of platform.usualFolders(platform.home(env))) if (!folders.includes(folder)) folders.push(folder)
  return platform.withSearchPath(env, folders.join(delimiter))
}
