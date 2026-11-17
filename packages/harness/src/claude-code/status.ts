import type { HarnessStatus } from '@repo/core'
import type { Cli } from '../process/cli.ts'
import { asString, firstObject } from '../process/json.ts'
import { run } from '../process/run.ts'

/** How long the CLI has to say its version or who is signed in. */
const STATUS_TIMEOUT_MS = 15_000

export const NOT_INSTALLED = 'Claude Code is not installed. Install it from claude.com/claude-code, then sign in.'
export const SIGNED_OUT = 'Claude Code is not signed in. Sign in to it, then try again.'

/** The version out of what `--version` prints: "2.1.322 (Claude Code)". */
export function readVersion(output: string): string | undefined {
  const line = output.trim().split('\n')[0]?.trim()
  return line?.match(/\d+(\.\d+)+\S*/)?.[0] ?? (line || undefined)
}

/**
 * Who is signed in, out of what `auth status --json` prints. The CLI answers the same way, with an error
 * code, when nobody is.
 */
export function readAccount(output: string): { signedIn: boolean; account?: string } | undefined {
  const answer = firstObject(output)
  if (!answer) return undefined
  const account = [asString(answer.email), asString(answer.subscriptionType)].filter(Boolean).join(' · ')
  return { signedIn: answer.loggedIn === true, ...(account ? { account } : {}) }
}

export async function status(cli: Cli): Promise<HarnessStatus> {
  const launch = await cli.find()
  if (!launch) return { installed: false, signedIn: false, problem: NOT_INSTALLED }
  try {
    const options = { env: launch.env, timeoutMs: STATUS_TIMEOUT_MS }
    const version = readVersion((await run(launch.command, ['--version'], options)).stdout)
    const account = readAccount((await run(launch.command, ['auth', 'status', '--json'], options)).stdout)
    if (!account) return { installed: true, signedIn: false, ...(version ? { version } : {}), problem: 'Claude Code did not say whether it is signed in.' }
    return {
      installed: true,
      ...account,
      ...(version ? { version } : {}),
      ...(account.signedIn ? {} : { problem: 'Claude Code is not signed in.' })
    }
  } catch (error) {
    return {
      installed: true,
      signedIn: false,
      problem: `Claude Code could not be asked for its status: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
