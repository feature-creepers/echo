import { locate } from '../locate.ts'
import { launch, type OpenTerminal, type TerminalLaunch, type TerminalRequest } from './terminal.ts'
import { commandLine, words } from './unix.ts'

/**
 * Linux has no terminal of its own: each desktop ships one, and each takes the command its own way, as
 * separate words or as one line. They are tried in this order, the system's declared choice first.
 */
const TERMINALS: Array<{ program: string; args(words: string[], line: string): string[] }> = [
  { program: 'x-terminal-emulator', args: (_, line) => ['-e', line] },
  { program: 'gnome-terminal', args: (all) => ['--', ...all] },
  { program: 'konsole', args: (all) => ['-e', ...all] },
  { program: 'xfce4-terminal', args: (_, line) => ['-e', line] },
  { program: 'kitty', args: (all) => all },
  { program: 'alacritty', args: (all) => ['-e', ...all] },
  { program: 'ptyxis', args: (all) => ['--', ...all] },
  { program: 'kgx', args: (all) => ['-e', ...all] },
  { program: 'foot', args: (all) => all },
  { program: 'xterm', args: (_, line) => ['-e', line] }
]

/** What to start, given which terminal programs are installed. Nothing when none is. */
export function plan(request: Pick<TerminalRequest, 'command' | 'variables'>, find: (program: string) => string | undefined): TerminalLaunch | undefined {
  for (const terminal of TERMINALS) {
    const file = find(terminal.program)
    if (file) return { file, args: terminal.args(words(request), commandLine(request)) }
  }
  return undefined
}

export const openTerminal: OpenTerminal = async (request) => {
  const found = plan(request, (program) => locate(program, request.env, []))
  if (!found) throw new Error(`No terminal program was found. Run "${commandLine(request)}" in a terminal.`)
  await launch(found, request.env)
}
