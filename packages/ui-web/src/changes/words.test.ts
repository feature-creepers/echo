import type { AccessUse, FileChange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { changedInWords, drawnLines, minus, numberWidth, plus, relativePath, splitPath, totalOf, unchangedAround } from './words.ts'

describe('a path as the person reads it', () => {
  const cases: { path: string; folders: (string | undefined)[]; shown: string }[] = [
    { path: '/home/ada/atlas/src/index.ts', folders: ['/home/ada/atlas', '/data/workspace'], shown: 'src/index.ts' },
    { path: '/data/workspace/notes.md', folders: ['/home/ada/atlas', '/data/workspace'], shown: 'notes.md' },
    { path: '/data/workspace/notes.md', folders: [undefined, '/data/workspace/'], shown: 'notes.md' },
    { path: '/home/ada/atlas-old/a.ts', folders: ['/home/ada/atlas'], shown: '/home/ada/atlas-old/a.ts' },
    { path: '/etc/hosts', folders: [undefined, undefined], shown: '/etc/hosts' },
    { path: '/home/ada/atlas', folders: ['/home/ada/atlas'], shown: '.' },
    { path: 'C:\\Users\\Ada\\atlas\\src\\a.ts', folders: ['c:\\users\\ada\\atlas'], shown: 'src\\a.ts' },
    { path: 'C:/Users/Ada/notes.md', folders: ['C:\\Users\\Ada'], shown: 'notes.md' }
  ]
  for (const { path, folders, shown } of cases) {
    it(`${path} → ${shown}`, () => expect(relativePath(path, folders)).toBe(shown))
  }

  it('splits where the name starts, so the name stays in sight', () => {
    expect(splitPath('src/conversation/thread-view.tsx')).toEqual({ folder: 'src/conversation/', name: 'thread-view.tsx' })
    expect(splitPath('README.md')).toEqual({ folder: '', name: 'README.md' })
  })
})

describe('the lines of a diff, as drawn', () => {
  it('numbers each line in the versions it is in, and marks a line with no line break', () => {
    const lines = drawnLines({ before: { start: 4, count: 3 }, after: { start: 4, count: 3 }, lines: [' a', '-b', '+B', ' c', '\\'] })
    expect(lines).toEqual([
      { kind: 'context', text: 'a', before: 4, after: 4 },
      { kind: 'removed', text: 'b', before: 5 },
      { kind: 'added', text: 'B', after: 5 },
      { kind: 'context', text: 'c', before: 6, after: 6, unended: true }
    ])
  })

  it('counts the unchanged lines between hunks, and after the last', () => {
    const hunks = [
      { before: { start: 5, count: 7 }, after: { start: 5, count: 7 }, lines: [] },
      { before: { start: 30, count: 6 }, after: { start: 30, count: 7 }, lines: [] }
    ]
    expect(unchangedAround({ hunks, lines: { before: 40, after: 41 } })).toEqual({ before: [4, 18], after: 5 })
    expect(unchangedAround({ hunks: [{ before: { start: 1, count: 0 }, after: { start: 1, count: 2 }, lines: [] }], lines: { before: 0, after: 2 } })).toEqual({
      before: [0],
      after: 0
    })
  })

  it('makes room for the widest line number', () => {
    expect(numberWidth({ lines: { before: 9, after: 1200 } })).toBe(4)
    expect(numberWidth({ lines: { before: 0, after: 0 } })).toBe(1)
  })
})

describe('what changed, in words', () => {
  const file = (status: FileChange['status'], added: number, removed: number): FileChange => ({ path: '/a', status, added, removed })
  it('says how many files, and the lines added and removed in all', () => {
    expect(changedInWords([file('changed', 40, 7), file('created', 2, 0), file('changed', 0, 0)])).toEqual({ files: '3 files changed', added: 42, removed: 7 })
    expect(changedInWords([file('created', 10, 0)])).toEqual({ files: '1 file created', added: 10, removed: 0 })
    expect(changedInWords([file('deleted', 0, 3)]).files).toBe('1 file deleted')
    expect(`${plus(1200)} ${minus(7)}`).toBe('+1,200 \u22127')
  })
})

describe('what a use changed in all', () => {
  const use = (changes: FileChange[] | undefined): AccessUse => ({
    id: 'u',
    at: '2026-11-18T10:00:00Z',
    tool: 'apply_patch',
    action: 'change',
    paths: [],
    decision: 'ran',
    reason: 'level',
    ...(changes ? { changes } : {})
  })
  it('adds up its files, and says when its one file is not text', () => {
    expect(
      totalOf(
        use([
          { path: '/a', status: 'changed', added: 3, removed: 1 },
          { path: '/b', status: 'created', added: 4, removed: 0 }
        ])
      )
    ).toEqual({ added: 7, removed: 1 })
    expect(totalOf(use([{ path: '/a', status: 'changed', added: 0, removed: 0, binary: true }]))).toMatchObject({ binary: true })
    expect(totalOf(use(undefined))).toBeUndefined()
  })
})
