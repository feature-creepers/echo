import { describe, expect, it } from 'vitest'
import { languageOf } from './languages.ts'
import { type Language, type Painted, paintHunk, paintLines, type Role, textRuns } from './syntax.ts'

const language = (path: string): Language => {
  const found = languageOf(path)
  if (!found) throw new Error(`No language for ${path}`)
  return found
}

/** A line's coloured runs as text and role, so a case reads as the line does. */
const runsOf = (line: string, painted: readonly Painted[]) => painted.map(([start, end, role]) => [line.slice(start, end), role] as const)

/** Lines read in order with the language of a file, each as its coloured runs. */
const paint = (path: string, ...lines: string[]) => paintLines(lines, language(path)).map((painted, index) => runsOf(lines[index] ?? '', painted))

type Case = [file: string, line: string, runs: (readonly [string, Role])[]]

describe('colouring a line by its language', () => {
  it.each<Case>([
    [
      'a.ts',
      'export const name: string = "Ada" // the default',
      [
        ['export', 'keyword'],
        ['const', 'keyword'],
        ['string', 'type'],
        ['"Ada"', 'string'],
        ['// the default', 'comment']
      ]
    ],
    [
      'a.ts',
      'function speak(words: Words, times = 2) {',
      [
        ['function', 'keyword'],
        ['speak', 'function'],
        ['Words', 'type'],
        ['2', 'number']
      ]
    ],
    [
      'a.ts',
      'const MAX_ROWS = 400',
      [
        ['const', 'keyword'],
        ['MAX_ROWS', 'number'],
        ['400', 'number']
      ]
    ],
    [
      'a.ts',
      'if (done) return null',
      [
        ['if', 'keyword'],
        ['return', 'keyword'],
        ['null', 'number']
      ]
    ],
    // A word after a dot is a property, whatever it is elsewhere.
    ['a.ts', 'event.type = this.default', [['this', 'keyword']]],
    ['a.ts', 'rows.map(toRow)', [['map', 'function']]],
    [
      'a.ts',
      'const at = text.search(/[\\\\/]+$/)',
      [
        ['const', 'keyword'],
        ['search', 'function'],
        ['/[\\\\/]+$/', 'string']
      ]
    ],
    // A slash after a value divides.
    ['a.ts', 'half = (width) / 2 / scale', [['2', 'number']]],
    [
      'a.ts',
      'const id = `one-two`',
      [
        ['const', 'keyword'],
        ['`one-two`', 'string']
      ]
    ],
    [
      'a.ts',
      "const quote = 'it\\'s'",
      [
        ['const', 'keyword'],
        ["'it\\'s'", 'string']
      ]
    ],
    [
      'a.tsx',
      '<Card title="Now">',
      [
        ['Card', 'type'],
        ['"Now"', 'string']
      ]
    ],
    [
      'a.ts',
      '@Component class Panel {}',
      [
        ['@Component', 'function'],
        ['class', 'keyword'],
        ['Panel', 'type']
      ]
    ],
    [
      'a.ts',
      'const big = 0x1f + 1_000 + 2.5e3',
      [
        ['const', 'keyword'],
        ['0x1f', 'number'],
        ['1_000', 'number'],
        ['2.5e3', 'number']
      ]
    ],
    [
      'a.py',
      'def speak(self, words: str) -> None:  # aloud',
      [
        ['def', 'keyword'],
        ['speak', 'function'],
        ['str', 'type'],
        ['None', 'number'],
        ['# aloud', 'comment']
      ]
    ],
    ['a.py', '@dataclass', [['@dataclass', 'function']]],
    [
      'a.go',
      'func (s *Server) Serve() error {',
      [
        ['func', 'keyword'],
        ['Serve', 'function'],
        ['error', 'type']
      ]
    ],
    [
      'a.rs',
      "fn first<'a>(x: &'a str) -> Option<&'a str> {",
      [
        ['fn', 'keyword'],
        ['first', 'function'],
        ["'a", 'type'],
        ["'a", 'type'],
        ['str', 'type'],
        ['Option', 'type'],
        ["'a", 'type'],
        ['str', 'type']
      ]
    ],
    [
      'a.rs',
      'let c = \'x\'; println!("{c}");',
      [
        ['let', 'keyword'],
        ["'x'", 'string'],
        ['println!', 'function'],
        ['"{c}"', 'string']
      ]
    ],
    [
      'a.c',
      '#include <stdio.h>',
      [
        ['#include', 'keyword'],
        ['<stdio.h>', 'string']
      ]
    ],
    [
      'a.cs',
      'public sealed class Echo : IDisposable',
      [
        ['public', 'keyword'],
        ['sealed', 'keyword'],
        ['class', 'keyword'],
        ['Echo', 'type'],
        ['IDisposable', 'type']
      ]
    ],
    [
      'a.java',
      '@Override public void run() {',
      [
        ['@Override', 'function'],
        ['public', 'keyword'],
        ['void', 'type'],
        ['run', 'function']
      ]
    ],
    [
      'a.json',
      '  "name": "echo", "private": true, "count": 3',
      [
        ['"name"', 'type'],
        ['"echo"', 'string'],
        ['"private"', 'type'],
        ['true', 'number'],
        ['"count"', 'type'],
        ['3', 'number']
      ]
    ],
    [
      'run.sh',
      'echo "$HOME" # where',
      [
        ['echo', 'function'],
        ['"$HOME"', 'string'],
        ['# where', 'comment']
      ]
    ],
    // A shell's `#` starts a comment only at the start of a word.
    [
      'run.sh',
      'if [ $# -gt 0 ]; then',
      [
        ['if', 'keyword'],
        ['$#', 'type'],
        ['0', 'number'],
        ['then', 'keyword']
      ]
    ],
    [
      'run.ps1',
      'if ($Path -eq $null) { Get-Item -Path $Path }',
      [
        ['if', 'keyword'],
        ['$Path', 'type'],
        ['-eq', 'keyword'],
        ['$null', 'number'],
        ['Get-Item', 'function'],
        ['-Path', 'type'],
        ['$Path', 'type']
      ]
    ],
    [
      'run.ps1',
      'FOREACH ($a in $b) {}',
      [
        ['FOREACH', 'keyword'],
        ['$a', 'type'],
        ['in', 'keyword'],
        ['$b', 'type']
      ]
    ],
    ['run.cmd', '@REM nothing here', [['REM nothing here', 'comment']]],
    [
      'run.cmd',
      'set "OUT=%TEMP%\\out"',
      [
        ['set', 'keyword'],
        ['"OUT=%TEMP%\\out"', 'string']
      ]
    ],
    [
      'query.sql',
      'SELECT name FROM people WHERE age > 30 -- adults',
      [
        ['SELECT', 'keyword'],
        ['FROM', 'keyword'],
        ['WHERE', 'keyword'],
        ['30', 'number'],
        ['-- adults', 'comment']
      ]
    ],
    [
      'a.css',
      '  color: #fff !important;',
      [
        ['color', 'type'],
        ['#fff', 'number'],
        ['!important', 'keyword']
      ]
    ],
    [
      'a.css',
      'a:hover { margin: 0 4px; }',
      [
        ['margin', 'type'],
        ['0', 'number'],
        ['4px', 'number']
      ]
    ],
    [
      'index.html',
      '<a href="/home" class=\'x\'>Home 2</a>',
      [
        ['a', 'keyword'],
        ['href', 'type'],
        ['"/home"', 'string'],
        ['class', 'type'],
        ["'x'", 'string'],
        ['a', 'keyword']
      ]
    ],
    // Prose has no numbers of its own, and an apostrophe opens no string.
    ['README.md', "## It's 2 o'clock", [["## It's 2 o'clock", 'keyword']]],
    [
      'README.md',
      '- Run `pnpm check` [first](docs/a.md).',
      [
        ['-', 'keyword'],
        ['`pnpm check`', 'string'],
        ['(docs/a.md)', 'string']
      ]
    ],
    [
      'ci.yml',
      '  - name: "Check" # every push',
      [
        ['-', 'keyword'],
        ['name', 'type'],
        ['"Check"', 'string'],
        ['# every push', 'comment']
      ]
    ],
    [
      'ci.yml',
      'enabled: true',
      [
        ['enabled', 'type'],
        ['true', 'number']
      ]
    ],
    ['Cargo.toml', '[package]', [['[package]', 'keyword']]],
    [
      'Cargo.toml',
      'version = "0.1.0" # first',
      [
        ['version', 'type'],
        ['"0.1.0"', 'string'],
        ['# first', 'comment']
      ]
    ],
    [
      '.env.local',
      'export API_URL="http://localhost"',
      [
        ['export', 'keyword'],
        ['API_URL', 'type'],
        ['"http://localhost"', 'string']
      ]
    ],
    [
      'Dockerfile',
      'FROM node:24 AS build',
      [
        ['FROM', 'keyword'],
        ['24', 'number'],
        ['AS', 'keyword']
      ]
    ],
    [
      'Makefile',
      'build: $(OUT)',
      [
        ['build', 'function'],
        ['$(OUT)', 'type']
      ]
    ],
    [
      '.gitignore',
      '!keep.txt # kept',
      [
        ['!', 'keyword'],
        ['# kept', 'comment']
      ]
    ]
  ])('%s: %s', (file, line, runs) => {
    expect(paint(file, line)[0]).toEqual(runs)
  })

  it('draws a file it knows no language for plain', () => {
    expect(languageOf('notes.txt')).toBeUndefined()
    expect(languageOf('LICENSE')).toBeUndefined()
  })

  it.each([
    ['C:\\Echo\\src\\App.TSX', 'a.tsx'],
    ['/home/ada/Makefile', 'Makefile'],
    ['/srv/Dockerfile.dev', 'Dockerfile'],
    ['C:\\Echo\\.zshrc', 'run.sh']
  ])('knows %s by its name, whatever its folder and capitals', (path, like) => {
    expect(languageOf(path)).toBe(languageOf(like))
  })
})

describe('what one line leaves open for the next', () => {
  it('carries a block comment over lines, to its end', () => {
    expect(paint('a.ts', '/** Speaks', ' * aloud', ' */ const a = 1')).toEqual([
      [['/** Speaks', 'comment']],
      [[' * aloud', 'comment']],
      [
        [' */', 'comment'],
        ['const', 'keyword'],
        ['1', 'number']
      ]
    ])
  })

  it('carries a multiline string, and a Python docstring', () => {
    expect(paint('a.ts', 'const a = `one', 'two` + b')).toEqual([
      [
        ['const', 'keyword'],
        ['`one', 'string']
      ],
      [['two`', 'string']]
    ])
    expect(paint('a.py', '"""Speaks', 'aloud."""', 'x = 1')).toEqual([[['"""Speaks', 'string']], [['aloud."""', 'string']], [['1', 'number']]])
  })

  it('ends a string that may not run over lines with its line', () => {
    expect(paint('a.ts', 'const a = "open', 'b = 1')).toEqual([
      [
        ['const', 'keyword'],
        ['"open', 'string']
      ],
      [['1', 'number']]
    ])
  })

  it('finds a hunk that starts inside a block comment by its end, met before any start', () => {
    expect(paint('a.ts', 'the person hears it', '*/', 'const a = 1')).toEqual([
      [['the person hears it', 'comment']],
      [['*/', 'comment']],
      [
        ['const', 'keyword'],
        ['1', 'number']
      ]
    ])
  })

  it('finds it by a first line that reads as the middle of a documentation comment', () => {
    expect(paint('a.ts', ' * Speaks aloud, as if', ' * the person')).toEqual([[[' * Speaks aloud, as if', 'comment']], [[' * the person', 'comment']]])
  })

  it('reads an end met after a start as code, not as a sign the hunk began in a comment', () => {
    expect(paint('a.ts', '/* a */ x', 'y */ 2')).toEqual([[['/* a */', 'comment']], [['2', 'number']]])
  })
})

describe('a hunk', () => {
  it('reads each version in order: what a change opens colours what follows it in that version only', () => {
    const lines = [
      { kind: 'removed', text: 'const a = 1' },
      { kind: 'added', text: '/* const a = 1' },
      { kind: 'context', text: 'const b = 2' }
    ] as const
    const painted = paintHunk(lines, language('a.ts')).map((one, index) => runsOf(lines[index]?.text ?? '', one))
    expect(painted).toEqual([
      [
        ['const', 'keyword'],
        ['1', 'number']
      ],
      [['/* const a = 1', 'comment']],
      [['const b = 2', 'comment']]
    ])
  })
})

describe('cutting a line where its colours and marks start and end', () => {
  it.each<[string, Painted[], [number, number][], ReturnType<typeof textRuns>]>([
    [
      'colours alone',
      [[0, 5, 'keyword']],
      [],
      [
        {
          marked: false,
          pieces: [
            { start: 0, end: 5, role: 'keyword' },
            { start: 5, end: 10 }
          ]
        }
      ]
    ],
    [
      'marks alone',
      [],
      [[2, 4]],
      [
        { marked: false, pieces: [{ start: 0, end: 2 }] },
        { marked: true, pieces: [{ start: 2, end: 4 }] },
        { marked: false, pieces: [{ start: 4, end: 10 }] }
      ]
    ],
    [
      'a mark across two colours, drawn as one mark',
      [
        [0, 3, 'keyword'],
        [4, 7, 'string']
      ],
      [[2, 6]],
      [
        { marked: false, pieces: [{ start: 0, end: 2, role: 'keyword' }] },
        {
          marked: true,
          pieces: [
            { start: 2, end: 3, role: 'keyword' },
            { start: 3, end: 4 },
            { start: 4, end: 6, role: 'string' }
          ]
        },
        {
          marked: false,
          pieces: [
            { start: 6, end: 7, role: 'string' },
            { start: 7, end: 10 }
          ]
        }
      ]
    ],
    ['nothing', [], [], [{ marked: false, pieces: [{ start: 0, end: 10 }] }]]
  ])('%s', (_name, painted, marks, runs) => {
    expect(textRuns(10, painted, marks)).toEqual(runs)
  })
})

describe('time', () => {
  it('stays linear in the text, whatever is left open', () => {
    const long = `const a = "${'x\\"'.repeat(600)}" /* ${'y '.repeat(600)}`
    const lines = Array.from({ length: 4_000 }, () => long)
    const started = performance.now()
    paintLines(lines, language('a.ts'))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
