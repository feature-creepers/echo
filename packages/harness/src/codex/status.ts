import type { HarnessStatus } from '@repo/core'
import type { Cli } from '../process/cli.ts'
import { readVersion } from '../process/output.ts'
import { run } from '../process/run.ts'

/** How long the CLI has to say its version or who is signed in. */
const STATUS_TIMEOUT_MS = 15_000

export const NOT_INSTALLED = 'Codex is not installed. Install it from developers.openai.com/codex, then sign in.'
export const SIGNED_OUT = 'Codex is not signed in. Sign in to it, then try again.'

/** Who is signed in, out of what `login status` prints: "Logged in using ChatGPT", or "Not logged in". */
export function readAccount(output: string, code: number | null): { signedIn: boolean; account?: string } {
  const line = output.split('\n').find((candidate) => /logged in/i.test(candidate)) ?? ''
  const account = line.match(/using (.+)$/i)?.[1]?.trim()
  return { signedIn: code === 0 && /^logged in/i.test(line.trim()), ...(account ? { account } : {}) }
}

export async function status(cli: Cli): Promise<HarnessStatus> {
  const launch = await cli.find()
  if (!launch) return { installed: false, signedIn: false, problem: NOT_INSTALLED }
  try {
    const options = { env: launch.env, timeoutMs: STATUS_TIMEOUT_MS }
    const version = readVersion((await run(launch.command, ['--version'], options)).stdout)
    const login = await run(launch.command, ['login', 'status'], options)
    // Depending on its version, Codex says it on one stream or the other.
    const account = readAccount(`${login.stdout}\n${login.stderr}`, login.code)
    return {
      installed: true,
      ...account,
      ...(version ? { version } : {}),
      ...(account.signedIn ? {} : { problem: 'Codex is not signed in.' })
    }
  } catch (error) {
    return {
      installed: true,
      signedIn: false,
      problem: `Codex could not be asked for its status: ${error instanceof Error ? error.message : String(error)}`,
      unanswered: true
    }
  }
}
