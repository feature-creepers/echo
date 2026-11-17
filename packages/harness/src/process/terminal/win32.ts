import { quoteArgument } from '../platform/win32.ts'
import { launch, type OpenTerminal, type TerminalLaunch, type TerminalRequest } from './terminal.ts'

/**
 * Windows: `start` opens a new console window, and `cmd /k` keeps it open once the command ends, so the
 * user reads what it said. The whole line is written for the command interpreter and passed as it is.
 */
export function plan(request: Pick<TerminalRequest, 'command' | 'title'>): TerminalLaunch {
  const [program = '', ...args] = request.command
  const line = [`"${program}"`, ...args.map(quoteArgument)].join(' ')
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"start "${request.title}" cmd.exe /k "${line}""`], verbatim: true }
}

// The new console inherits the environment it is started with, so the variables go there.
export const openTerminal: OpenTerminal = (request) => launch(plan(request), { ...request.env, ...request.variables })
