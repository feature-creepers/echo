import type { TerminalRequest } from './terminal.ts'

/** One word as a Unix shell must read it. */
export function quoteWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

/**
 * The words to run. A terminal opened by the desktop does not inherit this process's environment, so the
 * variables the command needs are set by `env`, in front of it.
 */
export function words(request: Pick<TerminalRequest, 'command' | 'variables'>): string[] {
  const variables = Object.entries(request.variables).map(([name, value]) => `${name}=${value}`)
  return variables.length > 0 ? ['env', ...variables, ...request.command] : request.command
}

/** The same as one line, to type or to hand to a shell. */
export function commandLine(request: Pick<TerminalRequest, 'command' | 'variables'>): string {
  return words(request).map(quoteWord).join(' ')
}
