/**
 * Code coloured by its language, as a review of code shows it: lowlight reads the text with highlight.js's common
 * grammars, and each scope it names takes one of code's five hues, or the faint text of a comment.
 *
 * A diff holds only parts of a file, so each version of a hunk is read as one text, and a string or a comment that
 * runs over its lines colours each of them. What came before the hunk is not known: one that starts inside a block
 * comment reads as code.
 */

import { common, createLowlight } from 'lowlight'

/** What a run of characters is to its language, which is the colour it takes. */
export type Role = 'comment' | 'keyword' | 'string' | 'number' | 'type' | 'function'

/** A run of a line given a role: where it starts and ends, in characters, the end left out. */
export type Painted = readonly [start: number, end: number, role: Role]

type Lowlight = ReturnType<typeof createLowlight>
type Content = ReturnType<Lowlight['highlight']>['children'][number]

let instance: Lowlight | undefined
/** Made the first time a diff is drawn, so a window that shows none never registers the grammars. */
const lowlight = (): Lowlight => {
  instance ??= createLowlight(common)
  return instance
}

/**
 * The colour of each of highlight.js's scopes. A scope left out takes the colour of the one it is in, as an escape
 * inside a string does; `null` draws its text plain inside a coloured one, as the code inside a template string.
 */
const SCOPES: Readonly<Record<string, Role | null>> = {
  keyword: 'keyword',
  meta: 'keyword',
  section: 'keyword',
  bullet: 'keyword',
  name: 'keyword',
  'selector-tag': 'keyword',
  string: 'string',
  regexp: 'string',
  code: 'string',
  link: 'string',
  number: 'number',
  literal: 'number',
  symbol: 'number',
  type: 'type',
  built_in: 'type',
  title: 'type',
  attr: 'type',
  attribute: 'type',
  variable: 'type',
  'selector-id': 'type',
  'selector-class': 'type',
  'selector-attr': 'type',
  'selector-pseudo': 'type',
  comment: 'comment',
  quote: 'comment',
  subst: null
}

/** Scripts call a name before a colon an attribute, a parameter's or a key's, which a review leaves plain. */
const SCRIPT_SCOPES: Readonly<Record<string, Role | null>> = { ...SCOPES, attr: null }
const SCRIPT = /^(?:[cm]?[jt]sx?|javascript|typescript)$/

/** What a scope's second part says more precisely: `title.function_` names a function, `variable.language_` is `this`. */
const SUBSCOPES: Readonly<Record<string, Role>> = { function_: 'function', language_: 'keyword', constant_: 'number' }

/** Files highlight.js knows under another name: by their whole name, or by an extension it has no alias for. */
const KNOWN_AS: Readonly<Record<string, string>> = {
  makefile: 'makefile',
  gnumakefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  '.bashrc': 'bash',
  '.bash_profile': 'bash',
  '.zshrc': 'bash',
  '.zprofile': 'bash',
  '.profile': 'bash',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.gitmodules': 'ini',
  '.npmrc': 'ini',
  '.env': 'ini',
  pyi: 'python',
  pyw: 'python',
  ksh: 'bash',
  m: 'objectivec',
  webmanifest: 'json',
  mdx: 'markdown',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  ...Object.fromEntries(
    ['htm', 'xslt', 'xaml', 'csproj', 'fsproj', 'vbproj', 'vcxproj', 'props', 'targets', 'resx', 'vue', 'svelte'].map((one) => [one, 'xml'])
  )
}

/** The language a file is written in, by its name; none for a file highlight.js does not know, which is drawn plain. */
export function languageOf(path: string): string | undefined {
  const name = (path.split(/[\\/]/).at(-1) ?? path).toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : undefined
  const found = KNOWN_AS[name] ?? (name.startsWith('.env.') ? 'ini' : extension && (KNOWN_AS[extension] ?? extension))
  return found && lowlight().registered(found) ? found : undefined
}

/**
 * The colour of a scope met inside one coloured `inherited`, from its classes: `hljs-title`, then `function_`. A value
 * is one colour whatever its grammar finds in it, as JSON's `true`, a literal holding a keyword.
 */
function roleOf(classes: unknown, inherited: Role | undefined, scopes: Readonly<Record<string, Role | null>>): Role | undefined {
  if (!Array.isArray(classes) || inherited === 'number') return inherited
  const [scope, subscope] = classes.map(String)
  if (!scope?.startsWith('hljs-')) return inherited
  const role = (subscope === undefined ? undefined : SUBSCOPES[subscope]) ?? scopes[scope.slice('hljs-'.length)]
  return role === null ? undefined : (role ?? inherited)
}

/** Consecutive lines of one version read together with their language, each as its coloured runs. */
function paintLines(lines: readonly string[], language: string): Painted[][] {
  const painted: Painted[][] = lines.map(() => [])
  let tree: ReturnType<Lowlight['highlight']>
  try {
    tree = lowlight().highlight(language, lines.join('\n'))
  } catch {
    // A grammar that gives up on a text leaves it plain.
    return painted
  }
  const scopes = SCRIPT.test(language) ? SCRIPT_SCOPES : SCOPES
  let line = 0
  let column = 0
  const paint = (end: number, role: Role) => {
    const runs = painted[line]
    const last = runs?.at(-1)
    if (runs && last && last[1] === column && last[2] === role) runs[runs.length - 1] = [last[0], end, role]
    else runs?.push([column, end, role])
  }
  const visit = (nodes: readonly Content[], role: Role | undefined) => {
    for (const node of nodes) {
      if (node.type === 'element') visit(node.children, roleOf(node.properties.className, role, scopes))
      else if (node.type === 'text') {
        node.value.split('\n').forEach((part, index) => {
          if (index > 0) {
            line++
            column = 0
          }
          if (role && part.length > 0) paint(column + part.length, role)
          column += part.length
        })
      }
    }
  }
  visit(tree.children, undefined)
  return painted
}

/**
 * A hunk's lines painted: each version read in order, the lines removed with the unchanged ones and the lines
 * added with them, so what a change opens or closes colours what follows it in its own version. An unchanged line
 * takes its colours from the version after the change.
 */
export function paintHunk(lines: readonly { kind: 'context' | 'added' | 'removed'; text: string }[], language: string): Painted[][] {
  const before = lines.flatMap((line, index) => (line.kind === 'added' ? [] : [index]))
  const after = lines.flatMap((line, index) => (line.kind === 'removed' ? [] : [index]))
  const painted: Painted[][] = lines.map(() => [])
  const paintedBefore = before.some((index) => lines[index]?.kind === 'removed')
    ? paintLines(
        before.map((index) => lines[index]?.text ?? ''),
        language
      )
    : []
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
