import { lastLines } from '../output.ts'
import { run } from '../run.ts'
import type { OpenTerminal, TerminalLaunch, TerminalRequest } from './terminal.ts'
import { commandLine } from './unix.ts'

/** The first time, macOS asks the user whether this app may control Terminal, and waits for the answer. */
const ANSWER_TIMEOUT_MS = 120_000

/** macOS: Terminal is always there. It is told, in AppleScript, to run the command in a new window and come to the front. */
export function plan(request: Pick<TerminalRequest, 'command' | 'variables'>): TerminalLaunch {
  const line = commandLine(request).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return { file: 'osascript', args: ['-e', `tell application "Terminal" to do script "${line}"\ntell application "Terminal" to activate`] }
}

export const openTerminal: OpenTerminal = async (request) => {
  const { file, args } = plan(request)
  const result = await run({ program: file, leading: [] }, args, { env: request.env, timeoutMs: ANSWER_TIMEOUT_MS })
  if (result.code !== 0)
    throw new Error(`Terminal could not be opened: ${lastLines(result.stderr) || `exit code ${result.code}`}. Run "${commandLine(request)}" in a terminal.`)
}
