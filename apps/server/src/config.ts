import { parseArgs } from 'node:util'
import { CORE_TOKEN_VARIABLE, DATA_OPTION, EXIT_WITH_PARENT_FLAG, EXIT_WITH_PARENT_OPTION } from '@repo/protocol'

export interface Config {
  /** The token a client on this machine must present. */
  token: string
  /** The folder that holds the user's data. */
  data: string
  /** Stop when standard input closes, so the core never outlives the app that started it. */
  exitWithParent: boolean
}

/** The configuration cannot be used. The message is written for the person who started the core. */
export class ConfigError extends Error {}

export const USAGE = `Usage: server --${DATA_OPTION} <folder> [${EXIT_WITH_PARENT_FLAG}]

  --${DATA_OPTION} <folder>        The folder that holds the user's data. Created when missing.
                         Only one core may use a folder at a time.
  ${EXIT_WITH_PARENT_FLAG}     Stop when standard input closes.

The token a client must present is read from the ${CORE_TOKEN_VARIABLE} environment variable.
Once it accepts connections, the core prints one line on standard output saying where it listens.`

export function readConfig(args: string[], env: Record<string, string | undefined>): Config {
  const flags = readFlags(args)

  const token = env[CORE_TOKEN_VARIABLE]
  if (!token) throw new ConfigError(`The ${CORE_TOKEN_VARIABLE} environment variable is not set.`)

  const data = flags[DATA_OPTION]
  if (!data) throw new ConfigError(`The --${DATA_OPTION} option is missing: the core needs a folder for the user's data.`)

  return { token, data, exitWithParent: flags[EXIT_WITH_PARENT_OPTION] ?? false }
}

function readFlags(args: string[]) {
  try {
    return parseArgs({
      args,
      options: { [DATA_OPTION]: { type: 'string' }, [EXIT_WITH_PARENT_OPTION]: { type: 'boolean' } },
      strict: true,
      allowPositionals: false
    }).values
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error))
  }
}
