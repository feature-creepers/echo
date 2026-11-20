/**
 * Command lines cut into their simple commands and words, the way each shell reads them, before anything is
 * decided about them (`commands.ts` does that). Three shells: the POSIX shell (bash and sh, which is how Claude
 * Code runs a command, Git Bash on Windows), PowerShell, and Windows' own `cmd`.
 *
 * Nothing here runs or expands anything. A word keeps its variables and the commands inside it apart from its
 * text, so what a path names can be told from what only the shell would know once it runs.
 */

/** Which shell reads a line. */
export type Shell = 'posix' | 'powershell' | 'cmd'

/** A piece of a word: text as written with its quotes taken off, a variable, or a command inside it. */
export type Piece =
  | { kind: 'text'; text: string; quoted: boolean }
  /** `$HOME`, `${HOME}`, `$env:USERPROFILE`, `%APPDATA%`, by name; `environment` for PowerShell's `env:` scope. */
  | { kind: 'variable'; name: string; environment?: boolean }
  /**
   * `$(…)`, backticks, `<(…)`, a PowerShell group or script block: read as a command of its own. `call` when it
   * calls a method; `block` for a script block, which is code given to a command rather than a value.
   */
  | { kind: 'inner'; call?: boolean; block?: boolean }

export interface Word {
  pieces: Piece[]
}

/** Where a stage's output goes, or its input comes from, as a file. */
export interface Redirect {
  target: Word
  writes: boolean
}

/**
 * How a stage follows the one before it: `and` once that one succeeded (`&&`), `pipe` reading its output, `other`
 * whatever came of it (`;`, a new line, `||`, `&`, the start or end of a `( … )` group).
 */
export type Join = 'and' | 'pipe' | 'other'

/** One simple command: its words, the files it is redirected to, how it follows the stage before, and how its input comes. */
export interface Stage {
  words: Word[]
  redirects: Redirect[]
  join: Join
  /** It reads a here-document or a here-string. */
  fed: boolean
  /**
   * Commands inside its words and its here-documents, each a line of the same shell, read on their own: they run
   * just before it, from where the line is then.
   */
  inner: string[]
}

export interface Scanned {
  stages: Stage[]
  /** Something could not be read to its end: an unclosed quote or substitution. */
  unreadable: boolean
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/
const SPECIAL_VARIABLE = /^[0-9@*#?$!-]/

/** A word as plain text, variables written as `$NAME` and inner commands as `$(…)`. */
export function textOf(word: Word): string {
  return word.pieces.map((piece) => (piece.kind === 'text' ? piece.text : piece.kind === 'variable' ? `$${piece.name}` : piece.block ? '{…}' : '$(…)')).join('')
}

/** Whether a word is plain text only: no variable and no command inside it. */
export const isPlain = (word: Word) => word.pieces.every((piece) => piece.kind === 'text')

/** A scanner's state: the stages so far, the stage and the word being read. */
function scanState() {
  const scanned: Scanned = { stages: [], unreadable: false }
  let stage: Stage = { words: [], redirects: [], join: 'other', fed: false, inner: [] }
  let word: Piece[] | undefined
  /** An operator read, waiting for the word it applies to: a file, or what a here-document or here-string is. */
  let pending: { kind: 'file'; writes: boolean } | { kind: 'heredoc'; strip: boolean } | { kind: 'drop' } | undefined
  /**
   * The here-documents opened on the line, read after it, with the stage that reads each. One whose delimiter is not
   * quoted runs the commands in its text.
   */
  const heredocs: { delimiter: string; strip: boolean; expands: boolean; stage: Stage }[] = []
  /** The stage the commands found now run with, when it is not the one being read: a here-document's. */
  let into: Stage | undefined

  return {
    scanned,
    heredocs,
    get word() {
      return word
    },
    set word(next: Piece[] | undefined) {
      word = next
    },
    stage: () => stage,
    text(text: string, quoted: boolean) {
      word ??= []
      const last = word.at(-1)
      if (last?.kind === 'text' && last.quoted === quoted) last.text += text
      else word.push({ kind: 'text', text, quoted })
    },
    piece(piece: Piece) {
      word ??= []
      word.push(piece)
    },
    /** A command inside a word, run with the stage it is in. */
    inner(line: string) {
      ;(into ?? stage).inner.push(line)
    },
    /** Read, the commands found going to `target` when there is one. */
    within(target: Stage | undefined, read: () => void) {
      const before = into
      into = target ?? into
      read()
      into = before
    },
    /** The word read so far is whole. */
    endWord() {
      if (word === undefined) return
      const done: Word = { pieces: word }
      word = undefined
      if (pending?.kind === 'file') stage.redirects.push({ target: done, writes: pending.writes })
      else if (pending?.kind === 'heredoc')
        heredocs.push({
          delimiter: textOf(done),
          strip: pending.strip,
          expands: done.pieces.every((piece) => piece.kind !== 'text' || !piece.quoted),
          stage
        })
      else if (pending === undefined) stage.words.push(done)
      pending = undefined
    },
    expect(next: typeof pending) {
      pending = next
    },
    /** The stage read so far is whole; the next one follows it by `join`. */
    endStage(join: Join) {
      this.endWord()
      pending = undefined
      const empty = stage.words.length === 0 && stage.redirects.length === 0 && stage.inner.length === 0 && !stage.fed
      if (!empty) scanned.stages.push(stage)
      // A join with nothing before it, such as the `&&` after a group's `)`, keeps the boundary it follows.
      stage = { words: [], redirects: [], join: empty && stage.join === 'other' ? 'other' : join, fed: false, inner: [] }
    }
  }
}

/** Where the `)` that closes a group opened just before `from` is, quotes and nested groups skipped. -1 when there is none. */
function closing(text: string, from: number, open = '(', close = ')'): number {
  let depth = 1
  for (let at = from; at < text.length; at++) {
    const c = text[at]
    if (c === '\\' || (c === '`' && open === '{')) {
      at++
    } else if (c === "'") {
      const end = text.indexOf("'", at + 1)
      if (end < 0) return -1
      at = end
    } else if (c === '"') {
      for (at++; at < text.length && text[at] !== '"'; at++) if (text[at] === '\\' || text[at] === '`') at++
      if (at >= text.length) return -1
    } else if (c === open) depth++
    else if (c === close && --depth === 0) return at
  }
  return -1
}

// ---------------------------------------------------------------- the POSIX shell

/** A line as bash and sh read it. */
function scanPosix(text: string): Scanned {
  const state = scanState()
  const { scanned } = state
  let at = 0

  /** After a newline, the bodies of the here-documents opened on the line before it. */
  const skipHeredocs = (from: number) => {
    let next = from
    for (const { delimiter, strip, expands, stage } of state.heredocs.splice(0)) {
      while (next < text.length) {
        const found = text.indexOf('\n', next)
        const end = found < 0 ? text.length : found
        const ends = (strip ? text.slice(next, end).replace(/^\t+/, '') : text.slice(next, end)) === delimiter
        if (!ends && expands) expanded(next, end, stage)
        next = Math.min(end + 1, text.length)
        if (ends) break
      }
    }
    return next
  }

  /**
   * Text the shell expands without cutting it into words, from `from` to `to`: an unquoted here-document's, read by
   * `stage`, or an arithmetic expression. None of it is a word of the command, but the commands it substitutes run.
   */
  const expanded = (from: number, to: number, stage?: Stage) => {
    const word = state.word
    state.word = undefined
    state.within(stage, () => {
      for (let at = from; at < to; ) {
        const c = text[at]
        if (c === '\\') at += 2
        else if (c === '$') at = dollar(at, true)
        else if (c === '`') at = backticks(at)
        else at += 1
      }
    })
    state.word = word
  }

  /** `$…` at `from`, in a word or in double quotes. Returns where reading goes on. */
  const dollar = (from: number, quoted: boolean): number => {
    const next = text[from + 1]
    if (next === '(') {
      if (text[from + 2] === '(') {
        // Arithmetic: a number, though a command substituted in it runs.
        const end = closing(text, from + 3)
        if (end < 0 || text[end + 1] !== ')') {
          scanned.unreadable = true
          return text.length
        }
        expanded(from + 3, end)
        state.text('0', true)
        return end + 2
      }
      const end = closing(text, from + 2)
      if (end < 0) {
        scanned.unreadable = true
        return text.length
      }
      state.inner(text.slice(from + 2, end))
      state.piece({ kind: 'inner' })
      return end + 1
    }
    if (next === '{') {
      const end = text.indexOf('}', from + 2)
      if (end < 0) {
        scanned.unreadable = true
        return text.length
      }
      const body = text.slice(from + 2, end)
      if (body.includes('$(') || body.includes('`')) {
        // A default given by a command, `${x:-$(…)}`: that command is read too.
        const inner = /\$\((.*)\)|`(.*)`/.exec(body)
        if (inner) state.inner(inner[1] ?? inner[2] ?? '')
      }
      const name = IDENTIFIER.exec(body)?.[0] ?? SPECIAL_VARIABLE.exec(body)?.[0]
      // `${HOME}` is HOME; `${HOME:-/tmp}` or `${#x}` is something only the shell knows.
      state.piece({ kind: 'variable', name: name !== undefined && body === name ? name : '' })
      return end + 1
    }
    if (next === "'" && !quoted) {
      // ANSI-C quoting: `$'a\nb'`.
      let end = from + 2
      while (end < text.length && text[end] !== "'") end += text[end] === '\\' ? 2 : 1
      if (end >= text.length) scanned.unreadable = true
      state.text(text.slice(from + 2, end).replace(/\\(.)/g, '$1'), true)
      return end + 1
    }
    if (next === '"' && !quoted) return doubleQuoted(from + 2)
    const name = IDENTIFIER.exec(text.slice(from + 1))?.[0] ?? SPECIAL_VARIABLE.exec(text.slice(from + 1))?.[0]
    if (name !== undefined) {
      state.piece({ kind: 'variable', name })
      return from + 1 + name.length
    }
    state.text('$', quoted)
    return from + 1
  }

  /** Backticks at `from`: an older way of writing `$(…)`. */
  const backticks = (from: number): number => {
    let end = from + 1
    while (end < text.length && text[end] !== '`') end += text[end] === '\\' ? 2 : 1
    if (end >= text.length) {
      scanned.unreadable = true
      return text.length
    }
    state.inner(text.slice(from + 1, end).replace(/\\([`$\\])/g, '$1'))
    state.piece({ kind: 'inner' })
    return end + 1
  }

  /** The inside of double quotes, from just after the opening one. */
  const doubleQuoted = (from: number): number => {
    let next = from
    while (next < text.length) {
      const c = text[next] as string
      if (c === '"') return next + 1
      if (c === '\\') {
        const escaped = text[next + 1]
        if (escaped === '\n') next += 2
        else if (escaped !== undefined && '$`"\\'.includes(escaped)) {
          state.text(escaped, true)
          next += 2
        } else {
          state.text('\\', true)
          next += 1
        }
      } else if (c === '$') next = dollar(next, true)
      else if (c === '`') next = backticks(next)
      else {
        state.text(c, true)
        next += 1
      }
    }
    scanned.unreadable = true
    return next
  }

  /** `<` or `>` at `from`, with what may come with it. */
  const redirection = (from: number): number => {
    const word = state.word
    // A descriptor written just before the operator, as in `2>`, is not a word of the command.
    if (word?.length === 1 && word[0]?.kind === 'text' && !word[0].quoted && /^\d+$/.test(word[0].text)) state.word = undefined
    else state.endWord()
    const two = text.slice(from, from + 2)
    if (two === '<(' || two === '>(') {
      const end = closing(text, from + 2)
      if (end < 0) {
        scanned.unreadable = true
        return text.length
      }
      state.inner(text.slice(from + 2, end))
      state.piece({ kind: 'inner' })
      return end + 1
    }
    if (text.startsWith('<<<', from)) {
      state.stage().fed = true
      state.expect({ kind: 'drop' })
      return from + 3
    }
    if (two === '<<') {
      const strip = text[from + 2] === '-'
      state.stage().fed = true
      state.expect({ kind: 'heredoc', strip })
      return from + (strip ? 3 : 2)
    }
    if (two === '<&' || two === '>&') {
      // Another descriptor (`2>&1`, `>&-`), or with a name, a file (`>&out.txt`).
      let end = from + 2
      if (/[\d-]/.test(text[end] ?? '')) {
        while (/[\d-]/.test(text[end] ?? '')) end++
        return end
      }
      state.expect({ kind: 'file', writes: two === '>&' })
      return end
    }
    if (two === '<>') {
      state.expect({ kind: 'file', writes: true })
      return from + 2
    }
    if (text[from] === '<') {
      state.expect({ kind: 'file', writes: false })
      return from + 1
    }
    state.expect({ kind: 'file', writes: true })
    return from + (two === '>>' || two === '>|' ? 2 : 1)
  }

  while (at < text.length) {
    const c = text[at] as string
    if (c === '\\') {
      if (text[at + 1] === '\n') at += 2
      else if (at + 1 < text.length) {
        state.text(text[at + 1] as string, true)
        at += 2
      } else at += 1
    } else if (c === "'") {
      const end = text.indexOf("'", at + 1)
      if (end < 0) {
        scanned.unreadable = true
        state.text(text.slice(at + 1), true)
        break
      }
      state.text(text.slice(at + 1, end), true)
      at = end + 1
    } else if (c === '"') at = doubleQuoted(at + 1)
    else if (c === '`') at = backticks(at)
    else if (c === '$') at = dollar(at, false)
    else if (c === ' ' || c === '\t' || c === '\r') {
      state.endWord()
      at += 1
    } else if (c === '\n') {
      state.endStage('other')
      at = skipHeredocs(at + 1)
    } else if (c === '#' && state.word === undefined) {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end
    } else if (c === ';') {
      state.endStage('other')
      at += text[at + 1] === ';' || text[at + 1] === '&' ? 2 : 1
    } else if (c === '&') {
      if (text[at + 1] === '>') {
        state.endWord()
        state.expect({ kind: 'file', writes: true })
        at += text[at + 2] === '>' ? 3 : 2
      } else {
        state.endStage(text[at + 1] === '&' ? 'and' : 'other')
        at += text[at + 1] === '&' ? 2 : 1
      }
    } else if (c === '|') {
      if (text[at + 1] === '|') {
        state.endStage('other')
        at += 2
      } else {
        state.endStage('pipe')
        at += text[at + 1] === '&' ? 2 : 1
      }
    } else if (c === '(' || c === ')') {
      // A subshell or a group: what is inside is read as stages of the line.
      state.endStage('other')
      at += 1
    } else if (c === '<' || c === '>') at = redirection(at)
    else {
      state.text(c, false)
      at += 1
    }
  }
  state.endStage('other')
  return scanned
}

// ---------------------------------------------------------------- PowerShell

/** A line as PowerShell reads it: statements, pipelines, script blocks and groups read as lines of their own. */
function scanPowerShell(text: string): Scanned {
  const state = scanState()
  const { scanned } = state
  let at = 0

  /** A group, a subexpression or a script block from `from`, the opening sign just before it. */
  const group = (from: number, open: string, close: string, call = false): number => {
    const end = closing(text, from, open, close)
    if (end < 0) {
      scanned.unreadable = true
      return text.length
    }
    state.inner(text.slice(from, end))
    state.piece(call ? { kind: 'inner', call: true } : open === '{' ? { kind: 'inner', block: true } : { kind: 'inner' })
    return end + 1
  }

  /** `$…` at `from`. */
  const variable = (from: number): number => {
    const next = text[from + 1]
    if (next === '(') return group(from + 2, '(', ')')
    if (next === '{') {
      const end = text.indexOf('}', from + 2)
      if (end < 0) {
        scanned.unreadable = true
        return text.length
      }
      state.piece(variableOf(text.slice(from + 2, end)))
      return end + 1
    }
    const name = /^(?:[A-Za-z_][A-Za-z0-9_]*:)?[A-Za-z_][A-Za-z0-9_]*|^[_?^$]/.exec(text.slice(from + 1))?.[0]
    if (name === undefined) {
      state.text('$', false)
      return from + 1
    }
    state.piece(variableOf(name))
    return from + 1 + name.length
  }

  /** The inside of double quotes, from just after the opening one: backtick escapes, variables and subexpressions. */
  const doubleQuoted = (from: number): number => {
    let next = from
    while (next < text.length) {
      const c = text[next] as string
      if (c === '"') {
        if (text[next + 1] === '"') {
          state.text('"', true)
          next += 2
          continue
        }
        return next + 1
      }
      if (c === '`') {
        state.text(text[next + 1] ?? '', true)
        next += 2
      } else if (c === '$') next = variable(next)
      else {
        state.text(c, true)
        next += 1
      }
    }
    scanned.unreadable = true
    return next
  }

  while (at < text.length) {
    const c = text[at] as string
    if (c === '`') {
      if (text[at + 1] !== '\n' && text[at + 1] !== '\r') state.text(text[at + 1] ?? '', true)
      at += 2
    } else if (c === "'") {
      let end = at + 1
      let read = ''
      for (; end < text.length; end++) {
        if (text[end] === "'") {
          if (text[end + 1] !== "'") break
          end++
        }
        read += text[end]
      }
      if (end >= text.length) scanned.unreadable = true
      state.text(read, true)
      at = end + 1
    } else if (c === '"') at = doubleQuoted(at + 1)
    else if (c === '@' && (text[at + 1] === "'" || text[at + 1] === '"') && /[\r\n]/.test(text[at + 2] ?? '')) {
      // A here-string: text to its closing line, kept as text. A double-quoted one runs the subexpressions in it.
      const close = `\n${text[at + 1]}@`
      const found = text.indexOf(close, at + 2)
      const end = found < 0 ? text.length : found
      if (found < 0) scanned.unreadable = true
      if (text[at + 1] === '"') {
        const word = state.word
        state.word = undefined
        for (let next = at + 3; next < end; ) next = text[next] === '`' ? next + 2 : text[next] === '$' ? variable(next) : next + 1
        state.word = word
      }
      state.text(text.slice(at + 3, end), true)
      at = found < 0 ? text.length : end + close.length
    } else if (c === '@' && text[at + 1] === '(') at = group(at + 2, '(', ')')
    else if (c === '@' && text[at + 1] === '{') at = group(at + 2, '{', '}')
    else if (c === '$') at = variable(at)
    else if (c === '(') {
      // A method call reads its arguments as a group: `$file.Delete()`, `[IO.File]::WriteAllText(…)`.
      const last = state.word?.at(-1)
      const call = last !== undefined && (last.kind === 'variable' || (last.kind === 'text' && /[\w\]]$/.test(last.text)))
      at = group(at + 1, '(', ')', call)
    } else if (c === '{') at = group(at + 1, '{', '}')
    else if (c === ')' || c === '}') {
      state.endStage('other')
      at += 1
    } else if (c === ' ' || c === '\t' || c === '\r') {
      state.endWord()
      at += 1
    } else if (c === '\n' || c === ';') {
      state.endStage('other')
      at += 1
    } else if (c === '<' && text[at + 1] === '#') {
      const end = text.indexOf('#>', at + 2)
      at = end < 0 ? text.length : end + 2
    } else if (c === '#' && state.word === undefined) {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end
    } else if (c === '|') {
      if (text[at + 1] === '|') {
        state.endStage('other')
        at += 2
      } else {
        state.endStage('pipe')
        at += 1
      }
    } else if (c === '&' && text[at + 1] === '&') {
      state.endStage('and')
      at += 2
    } else if (c === '&' && state.word === undefined) {
      // The call operator: what follows is the program. As a word of its own, it is told apart from text.
      state.text('&', false)
      state.endWord()
      at += 1
    } else if (
      c === '=' &&
      state.word !== undefined &&
      state.stage().words.length === 0 &&
      /^\$?[\w:.]+(\?\?|[-+*/%])?$/.test(textOf({ pieces: state.word }))
    ) {
      // An assignment: `$x = …`, `$x+=…`, `name = 'value'` in a hashtable. `=` is a word of its own; in a later word (an
      // address) it is text.
      state.endWord()
      state.text('=', false)
      state.endWord()
      at += 1
    } else if (c === '>') {
      const word = state.word
      if (word?.length === 1 && word[0]?.kind === 'text' && !word[0].quoted && /^[\d*]$/.test(word[0].text)) state.word = undefined
      else state.endWord()
      if (text[at + 1] === '&') {
        at += 3
        continue
      }
      state.expect({ kind: 'file', writes: true })
      at += text[at + 1] === '>' ? 2 : 1
    } else {
      state.text(c, false)
      at += 1
    }
  }
  state.endStage('other')
  return scanned
}

/** A PowerShell variable as the analysis knows it: `env:APPDATA` is the environment's APPDATA, any other scope is left out. */
function variableOf(written: string): Piece {
  const [, scope, name = written] = /^(?:(env|global|script|local|private|using):)?(.*)$/i.exec(written) ?? []
  return scope?.toLowerCase() === 'env' ? { kind: 'variable', name: name.toUpperCase(), environment: true } : { kind: 'variable', name }
}

// ---------------------------------------------------------------- cmd

/** A line as Windows' `cmd` reads it. */
function scanCmd(text: string): Scanned {
  const state = scanState()
  const { scanned } = state
  let at = 0
  let quoted = false

  while (at < text.length) {
    const c = text[at] as string
    if (c === '"') {
      quoted = !quoted
      // An empty pair of quotes is still a word.
      if (!quoted && state.word === undefined) state.text('', true)
      at += 1
    } else if (quoted) {
      if (c === '%') at = percent(at, true)
      else {
        state.text(c, true)
        at += 1
      }
    } else if (c === '^') {
      state.text(text[at + 1] ?? '', true)
      at += 2
    } else if (c === '%') at = percent(at, false)
    else if (c === ' ' || c === '\t' || c === '\r') {
      state.endWord()
      at += 1
    } else if (c === '\n') {
      state.endStage('other')
      at += 1
    } else if (c === '&') {
      state.endStage(text[at + 1] === '&' ? 'and' : 'other')
      at += text[at + 1] === '&' ? 2 : 1
    } else if (c === '|') {
      if (text[at + 1] === '|') {
        state.endStage('other')
        at += 2
      } else {
        state.endStage('pipe')
        at += 1
      }
    } else if (c === '(' || c === ')') {
      state.endStage('other')
      at += 1
    } else if (c === '<' || c === '>') {
      const word = state.word
      if (word?.length === 1 && word[0]?.kind === 'text' && !word[0].quoted && /^\d$/.test(word[0].text)) state.word = undefined
      else state.endWord()
      if (text[at + 1] === '&') {
        at += 3
        continue
      }
      state.expect({ kind: 'file', writes: c === '>' })
      at += text[at + 1] === '>' ? 2 : 1
    } else {
      state.text(c, false)
      at += 1
    }
  }
  if (quoted) scanned.unreadable = true
  state.endStage('other')
  return scanned

  /** `%NAME%`, or a parameter of a batch file (`%1`, `%~dp0`), or a loop's variable (`%%i`). */
  function percent(from: number, inQuotes: boolean): number {
    const rest = text.slice(from + 1)
    const named = /^([A-Za-z_][\w()]*)%/.exec(rest)
    if (named) {
      state.piece({ kind: 'variable', name: (named[1] ?? '').toUpperCase() })
      return from + 2 + (named[1]?.length ?? 0)
    }
    const parameter = /^(%?~?[a-z]*\d|%[A-Za-z])/.exec(rest)
    if (parameter) {
      state.piece({ kind: 'variable', name: '' })
      return from + 1 + (parameter[1]?.length ?? 0)
    }
    state.text('%', inQuotes)
    return from + 1
  }
}

/** Read a line with the shell it is written for. */
export function scan(text: string, shell: Shell): Scanned {
  return shell === 'powershell' ? scanPowerShell(text) : shell === 'cmd' ? scanCmd(text) : scanPosix(text)
}
