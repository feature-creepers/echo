import { describe, expect, it } from 'vitest'
import { languageOf, type Painted, paintHunk, type Role, textRuns } from './syntax.ts'

/** Lines of a file added in a hunk, each as its coloured runs, as text and role so a case reads as the line does. */
const paint = (path: string, ...lines: string[]) => {
  const language = languageOf(path)
  if (!language) throw new Error(`No language for ${path}`)
  const painted = paintHunk(
    lines.map((text) => ({ kind: 'added', text })),
    language
  )
  return painted.map((runs, index) => runs.map(([start, end, role]) => [lines[index]?.slice(start, end), role] as const))
}

describe('colouring a line by its language', () => {
  it.each<[file: string, line: string, runs: (readonly [string, Role])[]]>([
    [
      'a.ts',
      'export const name: Words = "Ada" + 42 // the default',
      [
        ['export', 'keyword'],
        ['const', 'keyword'],
        ['Words', 'type'],
        ['"Ada"', 'string'],
        ['42', 'number'],
        ['// the default', 'comment']
      ]
    ],
    [
      'C:\\Echo\\src\\App.TSX',
      `function speak(words: string) { return say(\`a \${words}\`) }`,
      [
        ['function', 'keyword'],
        ['speak', 'function'],
        ['string', 'type'],
        ['return', 'keyword'],
        ['say', 'function'],
        ['`a ', 'string'],
        ['`', 'string']
      ]
    ],
    [
      'tools/run.py',
      'def speak(times=2): return "aloud"  # twice',
      [
        ['def', 'keyword'],
        ['speak', 'function'],
        ['2', 'number'],
        ['return', 'keyword'],
        ['"aloud"', 'string'],
        ['# twice', 'comment']
      ]
    ],
    [
      '/home/ada/package.json',
      '{ "name": "echo", "private": true, "size": 3 }',
      [
        ['"name"', 'type'],
        ['"echo"', 'string'],
        ['"private"', 'type'],
        ['true', 'number'],
        ['"size"', 'type'],
        ['3', 'number']
      ]
    ],
    [
      'run.sh',
      'if [ -f "$HOME/a" ]; then exit 1; fi # done',
      [
        ['if', 'keyword'],
        ['"', 'string'],
        ['$HOME', 'type'],
        ['/a"', 'string'],
        ['then', 'keyword'],
        ['exit', 'type'],
        ['fi', 'keyword'],
        ['# done', 'comment']
      ]
    ]
  ])('%s: %s', (file, line, runs) => {
    expect(paint(file, line)[0]).toEqual(runs)
  })

  it.each(['notes.xyz', 'LICENSE', '/srv/.gitignore'])('draws %s, whose language it does not know, plain', (path) => {
    expect(languageOf(path)).toBeUndefined()
  })

  it('knows a file by its whole name', () => {
    expect(languageOf('/home/ada/Makefile')).toBe('makefile')
    expect(languageOf('C:\\Echo\\.env.local')).toBe('ini')
  })
})

describe('a hunk', () => {
  it('reads each version as one text: a comment opened in one line colours the next, in its own version only', () => {
    const lines = [
      { kind: 'removed', text: 'const a = 1' },
      { kind: 'added', text: '/* const a = 1' },
      { kind: 'context', text: 'const b = 2 */ const c = 3' }
    ] as const
    const painted = paintHunk(lines, 'ts').map((runs, index) => runs.map(([start, end, role]) => [lines[index]?.text.slice(start, end), role]))
    expect(painted).toEqual([
      [
        ['const', 'keyword'],
        ['1', 'number']
      ],
      [['/* const a = 1', 'comment']],
      [
        ['const b = 2 */', 'comment'],
        ['const', 'keyword'],
        ['3', 'number']
      ]
    ])
  })

  it('stays quick on the longest diff a file shows', () => {
    const lines = Array.from({ length: 4_000 }, (_, index) => ({ kind: 'added' as const, text: `const a${index} = "${'x'.repeat(60)}" /* ${index} */` }))
    const started = performance.now()
    paintHunk(lines, 'ts')
    expect(performance.now() - started).toBeLessThan(1_000)
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
