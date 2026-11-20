/**
 * Code coloured by its language, as a review of code shows it: each line of a diff split into the words its
 * language gives a role (keywords, strings, numbers, comments, types, functions), from a table of each language's
 * rules (`languages.ts`) rather than a grammar. Done where the diff is drawn, with no library, in time linear in
 * the text.
 *
 * A diff holds only parts of a file, so each hunk is read from its first line, with what a comment or a string
 * left open carried from one line to the next. A hunk that starts inside a block comment is found by the comment's
 * end it meets before any start, or by a first line that reads as the middle of one.
 */

/** What a run of characters is to its language, which is the colour it takes. */
export type Role = 'comment' | 'keyword' | 'string' | 'number' | 'type' | 'function'

/** A run of a line given a role: where it starts and ends, in characters, the end left out. */
export type Painted = readonly [start: number, end: number, role: Role]

/** What runs from an opening mark to a closing one: a comment, a string. */
export interface Enclosure {
  open: string
  close: string
  role: Role
  /** The mark that makes the character after it plain, so it never closes: `\` in most strings. */
  escape?: string
  /** It may run over several lines; one that may not ends with its line when its close is missing. */
  multiline?: boolean
  /** A first line that reads as the middle of this enclosure, as a documentation comment's lines start with a star. */
  continues?: RegExp
}

/** A pattern of a language's own, tried first at each place: a decorator, a variable, a tag's name, a heading. */
export interface Rule {
  /** Sticky (`y`), and it may look behind where it is tried: `(?<=^\s*)` for the start of a line. */
  pattern: RegExp
  role: Role
}

/** How a language's text is read. Everything is optional: a language says only what it has. */
export interface Language {
  /** Marks that start a comment running to the end of the line. */
  lineComments?: readonly string[]
  /** A line comment's mark counts only at the start of a line or after a space, as a shell's `#` does. */
  commentAfterSpace?: boolean
  /** Comments and strings with an opening and a closing mark, the longest marks first where one starts another. */
  enclosures?: readonly Enclosure[]
  /** Patterns tried before anything else, in order. */
  rules?: readonly Rule[]
  keywords?: ReadonlySet<string>
  /** Words that are values: `true`, `null`. */
  constants?: ReadonlySet<string>
  types?: ReadonlySet<string>
  /** Words that are functions whatever follows them, as a shell's `echo`. */
  builtins?: ReadonlySet<string>
  /** Its words match the sets whatever their capitals, as SQL's and PowerShell's do. */
  anyCase?: boolean
  /** A word that starts with a capital is a type, as classes are written in most languages. */
  capitalTypes?: boolean
  /** A word in capitals is a constant: `MAX_SIZE`. */
  capitalConstants?: boolean
  /** A word before an opening bracket is a function called. */
  calls?: boolean
  /** Keywords that say what the next word is: `function` a function, `class` a type. */
  declares?: Readonly<Record<string, Role>>
  /** What a word is, sticky: letters, digits, `_` and `$` unless the language says otherwise. */
  word?: RegExp
  /** Numbers are coloured; not in prose, where they are words like the others. */
  numbers?: boolean
  /** A `/` where a value is expected starts a regular expression, as in JavaScript. */
  regexes?: boolean
  /** A string followed by a colon is a key, as in JSON. */
  keys?: boolean
}

/** What one line leaves open for the next. */
interface LineState {
  open?: Enclosure
}

const WORD = /[\p{L}_$][\p{L}\p{N}_$]*/uy
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[\p{L}\d_]*/uy
const CALL = /\s*\(/y
const SPACE = /\s/
const CAPITALS = /^[A-Z][A-Z\d]*_?[A-Z\d_]*$/
const CAPITAL = /^[A-Z]/
/** After these, a `/` divides; after anything else in code, it may start a regular expression. */
const ENDS_VALUE = new Set([')', ']', '}'])

/** Where an enclosure that started before `from` ends, past its closing mark; -1 when it does not end on this line. */
function closing(line: string, from: number, enclosure: Enclosure): number {
  let at = from
  while (at <= line.length - enclosure.close.length) {
    if (enclosure.escape && line.startsWith(enclosure.escape, at)) {
      at += enclosure.escape.length + 1
      continue
    }
    if (line.startsWith(enclosure.close, at)) return at + enclosure.close.length
    at++
  }
  return -1
}

/** Where a regular expression that starts at `at` ends, with its flags; -1 when the line has no end for it. */
function regexEnd(line: string, at: number): number {
  let inClass = false
  for (let index = at + 1; index < line.length; index++) {
    const char = line[index]
    if (char === '\\') index++
    else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      let end = index + 1
      while (end < line.length && /[a-z]/i.test(line[end] ?? '')) end++
      return end
    }
  }
  return -1
}

/** A sticky pattern's match at a place, never empty. */
function matchAt(pattern: RegExp, line: string, at: number): string | undefined {
  pattern.lastIndex = at
  const found = pattern.exec(line)?.[0]
  return found ? found : undefined
}

/** What reading one line found: its runs, what it leaves open, and whether it opened a comment or met one's end alone. */
interface LineRead {
  painted: Painted[]
  state: LineState
  /** It opened a comment that may run over lines, whether or not it closed it. */
  opened: boolean
  /** It met the end of a block comment in plain code, before any start: the hunk began inside that comment. */
  orphan?: Enclosure
}

/**
 * One line read with its language, from what the line before left open. `watchOrphans` asks it to report a block
 * comment's end met in plain code, which only means something while the hunk has opened none.
 */
function paintLine(line: string, language: Language, state: LineState, watchOrphans = false): LineRead {
  const painted: Painted[] = []
  const paint = (start: number, end: number, role: Role) => {
    if (end > start) painted.push([start, end, role])
  }
  let at = 0
  let opened = false
  if (state.open) {
    const end = closing(line, 0, state.open)
    if (end < 0) {
      paint(0, line.length, state.open.role)
      return { painted, state, opened }
    }
    paint(0, end, state.open.role)
    at = end
  }
  const enclosures = language.enclosures ?? []
  let expectsValue = true
  let afterDot = false
  let declared: Role | undefined
  while (at < line.length) {
    const char = line[at] ?? ''
    if (SPACE.test(char)) {
      at++
      continue
    }
    let rule: { end: number; role: Role } | undefined
    for (const { pattern, role } of language.rules ?? []) {
      const found = matchAt(pattern, line, at)
      if (found) {
        rule = { end: at + found.length, role }
        break
      }
    }
    if (rule) {
      paint(at, rule.end, rule.role)
      at = rule.end
      expectsValue = false
      afterDot = false
      continue
    }
    const enclosure = enclosures.find((one) => line.startsWith(one.open, at))
    if (enclosure) {
      if (enclosure.role === 'comment' && enclosure.multiline) opened = true
      const end = closing(line, at + enclosure.open.length, enclosure)
      if (end < 0) {
        paint(at, line.length, enclosure.role)
        return { painted, state: enclosure.multiline ? { open: enclosure } : {}, opened }
      }
      const key = language.keys && enclosure.role === 'string' && /^\s*:/.test(line.slice(end))
      paint(at, end, key ? 'type' : enclosure.role)
      at = end
      expectsValue = false
      afterDot = false
      continue
    }
    const comment = language.lineComments?.find((mark) => line.startsWith(mark, at))
    if (comment && (!language.commentAfterSpace || at === 0 || SPACE.test(line[at - 1] ?? ''))) {
      paint(at, line.length, 'comment')
      break
    }
    if (watchOrphans && !opened) {
      const orphan = enclosures.find((one) => one.role === 'comment' && one.multiline && one.close !== one.open && line.startsWith(one.close, at))
      if (orphan) return { painted, state: {}, opened, orphan }
    }
    if (language.regexes && char === '/' && expectsValue) {
      const end = regexEnd(line, at)
      if (end > 0) {
        paint(at, end, 'string')
        at = end
        expectsValue = false
        continue
      }
    }
    const number = language.numbers === false ? undefined : /[\d.]/.test(char) ? matchAt(NUMBER, line, at) : undefined
    if (number && number !== '.') {
      paint(at, at + number.length, 'number')
      at += number.length
      expectsValue = false
      afterDot = false
      continue
    }
    const word = matchAt(language.word ?? WORD, line, at)
    if (word) {
      const end = at + word.length
      const key = language.anyCase ? word.toLowerCase() : word
      let role: Role | undefined
      const keyword = !afterDot && language.keywords?.has(key) === true
      if (declared) role = declared
      else if (keyword) role = 'keyword'
      else if (!afterDot && language.constants?.has(key)) role = 'number'
      else if (!afterDot && language.types?.has(key)) role = 'type'
      else if (!afterDot && language.builtins?.has(key)) role = 'function'
      else if (language.calls && matchAt(CALL, line, end)) role = 'function'
      else if (language.capitalConstants && word.length > 1 && CAPITALS.test(word)) role = 'number'
      else if (language.capitalTypes && CAPITAL.test(word)) role = 'type'
      declared = keyword ? language.declares?.[key] : undefined
      if (role) paint(at, end, role)
      at = end
      expectsValue = keyword
      afterDot = false
      continue
    }
    expectsValue = !ENDS_VALUE.has(char)
    afterDot = char === '.'
    // A declaring keyword names the word right after it, a generator's star aside: `function (a)` names nothing.
    if (char !== '*') declared = undefined
    at++
  }
  return { painted, state: {}, opened }
}

/** A version's lines read in order from a starting state, or the comment found to have been open before them. */
function read(lines: readonly string[], language: Language, start: LineState): { painted: Painted[][]; orphan?: Enclosure } {
  const painted: Painted[][] = []
  let state = start
  let opened = start.open !== undefined
  for (const line of lines) {
    const result = paintLine(line, language, state, !opened)
    if (result.orphan) return { painted: [], orphan: result.orphan }
    painted.push(result.painted)
    state = result.state
    opened ||= result.opened || state.open !== undefined
  }
  return { painted }
}

/**
 * Consecutive lines of one version read with their language. They start as code, unless they show they start
 * inside a block comment: by its end met before any start, or by a first line that reads as one of its middle lines.
 */
export function paintLines(lines: readonly string[], language: Language): Painted[][] {
  const first = lines[0]
  const inside = first === undefined ? undefined : language.enclosures?.find((one) => one.continues?.test(first))
  if (inside) return read(lines, language, { open: inside }).painted
  const plain = read(lines, language, {})
  return plain.orphan ? read(lines, language, { open: plain.orphan }).painted : plain.painted
}

/**
 * A hunk's lines painted: each version read in order, the lines removed with the unchanged ones and the lines
 * added with them, so what a change opens or closes colours what follows it in its own version. An unchanged line
 * takes its colours from the version after the change.
 */
export function paintHunk(lines: readonly { kind: 'context' | 'added' | 'removed'; text: string }[], language: Language): Painted[][] {
  const before = lines.flatMap((line, index) => (line.kind === 'added' ? [] : [index]))
  const after = lines.flatMap((line, index) => (line.kind === 'removed' ? [] : [index]))
  const painted: Painted[][] = lines.map(() => [])
  const paintedBefore = paintLines(
    before.map((index) => lines[index]?.text ?? ''),
    language
  )
  const paintedAfter = paintLines(
    after.map((index) => lines[index]?.text ?? ''),
    language
  )
  before.forEach((index, at) => {
    if (lines[index]?.kind === 'removed') painted[index] = paintedBefore[at] ?? []
  })
  after.forEach((index, at) => {
    painted[index] = paintedAfter[at] ?? []
  })
  return painted
}

/** A part of a line drawn in one colour, plain when it has no role. */
interface Piece {
  start: number
  end: number
  role?: Role
}

/** Pieces drawn together, inside one mark of words changed or outside any. */
interface TextRun {
  marked: boolean
  pieces: Piece[]
}

/**
 * A line's text cut where its colours and its marks of words changed start and end, so each mark is drawn whole,
 * with its corners once, and the colours inside it.
 */
export function textRuns(length: number, painted: readonly Painted[], marks: readonly (readonly [number, number])[]): TextRun[] {
  const cuts = new Set([0, length])
  for (const [start, end] of painted) cuts.add(Math.min(start, length)).add(Math.min(end, length))
  for (const [start, end] of marks) cuts.add(Math.min(start, length)).add(Math.min(end, length))
  const points = [...cuts].sort((one, other) => one - other)
  const runs: TextRun[] = []
  let paintAt = 0
  let markAt = 0
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index] ?? 0
    const end = points[index + 1] ?? 0
    if (end <= start) continue
    while ((painted[paintAt]?.[1] ?? Number.POSITIVE_INFINITY) <= start) paintAt++
    while ((marks[markAt]?.[1] ?? Number.POSITIVE_INFINITY) <= start) markAt++
    const colour = painted[paintAt]
    const role = colour && colour[0] <= start ? colour[2] : undefined
    const mark = marks[markAt]
    const marked = mark !== undefined && mark[0] <= start
    let run = runs.at(-1)
    if (!run || run.marked !== marked) {
      run = { marked, pieces: [] }
      runs.push(run)
    }
    const last = run.pieces.at(-1)
    if (last && last.role === role && last.end === start) last.end = end
    else run.pieces.push(role ? { start, end, role } : { start, end })
  }
  return runs
}
