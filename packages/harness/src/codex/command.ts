/**
 * Codex's commands as the person reads them. Codex hands each command to a shell and names it with that shell's
 * own words around it (`/bin/bash -lc '…'`, `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command '…'`), quoted
 * as a POSIX shell quotes, whatever the system. What the person wants to see is the line inside.
 */

/** A word written back into a POSIX line, quoted so it reads as the one word it was. */
const quoted = (word: string) => (/^[\w./~:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

/** A command as Codex gives it, a line or its words, as one line to show the person and to read. */
export const commandLine = (value: unknown) =>
  Array.isArray(value) ? value.map((word) => quoted(String(word))).join(' ') : typeof value === 'string' ? value : ''

/** The shells Codex runs its commands with, by the name of their program, and how each is given a line. */
const SHELLS: Record<string, 'posix' | 'powershell' | 'cmd'> = {
  bash: 'posix',
  sh: 'posix',
  zsh: 'posix',
  dash: 'posix',
  pwsh: 'powershell',
  powershell: 'powershell',
  cmd: 'cmd'
}

/** The words of a POSIX line, unquoted. Nothing when a quote is left open. */
function posixWords(line: string): string[] | undefined {
  const words: string[] = []
  let word = ''
  let inWord = false
  for (let at = 0; at < line.length; at++) {
    const character = line[at] as string
    if (character === "'") {
      const end = line.indexOf("'", at + 1)
      if (end < 0) return undefined
      word += line.slice(at + 1, end)
      at = end
      inWord = true
    } else if (character === '"') {
      at++
      for (; at < line.length && line[at] !== '"'; at++) {
        // Within double quotes a backslash escapes only what the shell would read otherwise.
        if (line[at] === '\\' && at + 1 < line.length && '\\"$`\n'.includes(line[at + 1] as string)) at++
        word += line[at]
      }
      if (at >= line.length) return undefined
      inWord = true
    } else if (character === '\\') {
      if (at + 1 < line.length) word += line[++at]
      inWord = true
    } else if (/\s/.test(character)) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
    } else {
      word += character
      inWord = true
    }
  }
  if (inWord) words.push(word)
  return words
}

/** The program a line starts with, and what follows it: a path in double quotes keeps its backslashes, once unescaped. */
function programOf(line: string): { program: string; rest: string } | undefined {
  const found = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))\s+([\s\S]*)$/.exec(line)
  if (!found) return undefined
  const program = found[1]?.replace(/\\(.)/g, '$1') ?? found[2] ?? found[3] ?? ''
  return { program, rest: found[4] ?? '' }
}

/**
 * The line a command runs inside the shell Codex wraps it in: `ls -la | wc -l` for `/bin/bash -lc 'ls -la | wc -l'`.
 * A command that is not a shell given one line, or that cannot be read, is shown as given.
 */
export function shownCommand(line: string): string {
  const head = programOf(line)
  if (!head) return line
  const name = (head.program.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  const shell = SHELLS[name]
  if (!shell) return line
  let rest = head.rest.trim()
  if (shell === 'cmd') {
    const given = /^\/[ck]\s+([\s\S]+)$/i.exec(rest)?.[1]?.trim()
    return given || line
  }
  const flag = shell === 'posix' ? /^-[A-Za-z]*c[A-Za-z]*$/ : /^-(c|command)$/i
  // Options before the one that gives the line: `-l`, `-NoProfile`. One that takes a value is not followed.
  for (;;) {
    const found = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest)
    const option = found?.[1]
    if (option === undefined || !option.startsWith('-')) return line
    rest = found?.[2]?.trim() ?? ''
    if (flag.test(option)) break
  }
  if (rest === '') return line
  const words = posixWords(rest)
  if (words?.length === 1 && words[0]?.trim()) return (words[0] as string).trim()
  // PowerShell reads the rest of its line as the command; a POSIX shell's words after the line are its arguments.
  return shell === 'powershell' ? rest : line
}
