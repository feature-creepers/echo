import type { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { DATA_OPTION, EXIT_WITH_PARENT_FLAG, EXIT_WITH_PARENT_OPTION } from '@repo/protocol'

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

/** How long the core waits for its token: as long as the app that starts it waits for the line saying where it listens. */
const TOKEN_TIMEOUT_MS = 15_000

export const USAGE = `Usage: printf '%s\\n' "$TOKEN" | server --${DATA_OPTION} <folder> [${EXIT_WITH_PARENT_FLAG}]

  --${DATA_OPTION} <folder>        The folder that holds the user's data. Created when missing.
                         Only one core may use a folder at a time.
  ${EXIT_WITH_PARENT_FLAG}     Stop when standard input closes, once the token is read.

The token a client must present is the first line of standard input, given within ${TOKEN_TIMEOUT_MS / 1000} seconds. An
Electron app that starts the core as a utility process gives it on the port between them instead.
Once it accepts connections, the core prints one line on standard output saying where it listens.`

/**
 * The configuration, from the options the core was started with and the token the program that started it gives:
 * nothing, when that program gave none in time.
 */
export async function readConfig(args: string[], token: Promise<string | undefined>): Promise<Config> {
  const flags = readFlags(args)

  const data = flags[DATA_OPTION]
  if (!data) throw new ConfigError(`The --${DATA_OPTION} option is missing: the core needs a folder for the user's data.`)

  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), TOKEN_TIMEOUT_MS)))
  const given = await Promise.race([token, late]).finally(() => clearTimeout(timer))
  if (given === undefined) throw new ConfigError('No token was given.')
  if (given === '') throw new ConfigError('The token given is empty.')

  return { token: given, data, exitWithParent: flags[EXIT_WITH_PARENT_OPTION] ?? false }
}

/**
 * The first line of a stream, without its line ending, or what it held when it ended first: nothing, when it held
 * nothing. Reading stops at the line, though the stream's end may have come with it.
 */
export function firstLine(input: Readable): Promise<string | undefined> {
  return new Promise((resolve) => {
    let text = ''
    const done = (line: string | undefined) => {
      input.off('data', read).off('end', ended).off('error', ended)
      input.pause()
      resolve(line?.replace(/\r$/, ''))
    }
    const read = (chunk: string) => {
      text += chunk
      const end = text.indexOf('\n')
      if (end !== -1) done(text.slice(0, end))
    }
    const ended = () => done(text === '' ? undefined : text)
    input.setEncoding('utf8').on('data', read).once('end', ended).once('error', ended)
  })
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
