import { describe, expect, it } from 'vitest'
import { FILE_CELLS, lineMarks, markChanges, PAIR_CELLS } from './inline.ts'
import { drawnLines } from './words.ts'

/** The marked words of a line, as text. */
const marked = (line: string, marks: readonly (readonly [number, number])[]) => marks.map(([start, end]) => line.slice(start, end))

describe('the words changed within a line', () => {
  it.each([
    { name: 'a word replaced', before: 'const answer = 41', after: 'const answer = 42', removed: ['41'], added: ['42'] },
    { name: 'two words apart', before: 'let a = load(b)', after: 'let x = load(y)', removed: ['a', 'b'], added: ['x', 'y'] },
    {
      name: 'words side by side, read as one change',
      before: 'Say it once more.',
      after: 'Say it once again, slowly.',
      removed: ['more'],
      added: ['again, slowly']
    },
    { name: 'a word added', before: 'import { a } from "x"', after: 'import { a, b } from "x"', removed: [], added: [', b'] },
    { name: 'a word taken out', before: 'return cached ?? fresh', after: 'return fresh', removed: ['cached ??'], added: [] },
    { name: 'letters beyond the Latin alphabet', before: 'Ça coûte 12 €', after: 'Ça coûte 15 €', removed: ['12'], added: ['15'] },
    { name: 'only the spacing changed', before: 'a = 1', after: 'a  = 1', removed: [], added: [] },
    { name: 'the same line', before: 'same', after: 'same', removed: [], added: [] },
    { name: 'a line rewritten whole', before: 'return total', after: 'throw new Error("no total")', removed: [], added: [] }
  ])('$name', ({ before, after, removed, added }) => {
    const found = lineMarks(before, after)
    expect(marked(before, found.before)).toEqual(removed)
    expect(marked(after, found.after)).toEqual(added)
  })

  it('marks the middle whole when the lines are too long to compare word by word, and spends nothing', () => {
    const middle = (letter: string) => Array.from({ length: 300 }, (_, index) => `${letter}${index}`).join(' ')
    const before = `start ${middle('a')} end`
    const after = `start ${middle('b')} end`
    const found = lineMarks(before, after)
    // Rewritten whole in its middle: nothing is marked, as the line's tint says it.
    expect(found).toEqual({ before: [], after: [], cells: 0 })
    const long = `keep ${'word '.repeat(400)}one`
    expect(marked(long, lineMarks(long, `keep ${'word '.repeat(400)}two`).before)).toEqual(['one'])
  })

  it('compares a middle word by word only within the cells given, and reads it as rewritten past them', () => {
    expect(marked('a b c d', lineMarks('a b c d', 'a x c y', PAIR_CELLS).before)).toEqual(['b', 'd'])
    expect(lineMarks('a b c d', 'a x c y', 0)).toEqual({ before: [], after: [], cells: 0 })
  })
})

describe('the lines of a hunk, with their words marked', () => {
  const hunk = {
    before: { start: 1, count: 4 },
    after: { start: 1, count: 4 },
    lines: [' keep', '-const a = 1', '-const b = 2', '+const a = 10', '+const b = 2 // two', '+const c = 3', ' end']
  }

  it('compares the first line removed with the first added, the second with the second, and leaves a line with none alone', () => {
    const lines = markChanges(drawnLines(hunk), { cells: FILE_CELLS })
    expect(lines.map((line) => [line.text, marked(line.text, line.marks ?? [])])).toEqual([
      ['keep', []],
      ['const a = 1', ['1']],
      ['const b = 2', []],
      ['const a = 10', ['10']],
      ['const b = 2 // two', ['// two']],
      ['const c = 3', []],
      ['end', []]
    ])
  })

  it('spends the budget the file shares, and leaves the lines given as they were', () => {
    const drawn = drawnLines(hunk)
    const budget = { cells: FILE_CELLS }
    markChanges(drawn, budget)
    expect(budget.cells).toBeLessThan(FILE_CELLS)
    expect(drawn.some((line) => line.marks)).toBe(false)
  })
})
