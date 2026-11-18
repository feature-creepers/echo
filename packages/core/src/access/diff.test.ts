import { describe, expect, it } from 'vitest'
import { countChanges, diffText, textOf } from './diff.ts'

const lines = (count: number, from = 1) => Array.from({ length: count }, (_, index) => `line ${index + from}`)
const text = (list: readonly string[]) => list.map((line) => `${line}\n`).join('')

/** The version after, rebuilt from the version before and the hunks alone: what a unified diff promises. */
function rebuild(before: string, hunks: ReturnType<typeof diffText>['hunks']): string[] {
  const old = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const result: string[] = []
  let at = 0
  for (const hunk of hunks) {
    const start = hunk.before.count === 0 ? hunk.before.start - 1 : hunk.before.start - 1
    while (at < start) result.push(old[at++] ?? '')
    for (const line of hunk.lines) {
      if (line === '\\') continue
      if (line.startsWith('+')) result.push(line.slice(1))
      else {
        if (line.startsWith(' ')) result.push(line.slice(1))
        at++
      }
    }
  }
  while (at < old.length) result.push(old[at++] ?? '')
  return result
}

describe('a diff of two texts', () => {
  const cases: {
    name: string
    before: string
    after: string
    added: number
    removed: number
    hunks: { before: [number, number]; after: [number, number]; lines: string[] }[]
  }[] = [
    { name: 'identical', before: text(lines(5)), after: text(lines(5)), added: 0, removed: 0, hunks: [] },
    { name: 'both empty', before: '', after: '', added: 0, removed: 0, hunks: [] },
    {
      name: 'created',
      before: '',
      after: 'a\nb\n',
      added: 2,
      removed: 0,
      hunks: [{ before: [1, 0], after: [1, 2], lines: ['+a', '+b'] }]
    },
    {
      name: 'added at the start',
      before: text(lines(6)),
      after: text(['new', ...lines(6)]),
      added: 1,
      removed: 0,
      hunks: [{ before: [1, 3], after: [1, 4], lines: ['+new', ' line 1', ' line 2', ' line 3'] }]
    },
    {
      name: 'added at the end',
      before: text(lines(6)),
      after: text([...lines(6), 'new']),
      added: 1,
      removed: 0,
      hunks: [{ before: [4, 3], after: [4, 4], lines: [' line 4', ' line 5', ' line 6', '+new'] }]
    },
    {
      name: 'removed in the middle',
      before: text(lines(9)),
      after: text([...lines(4), ...lines(4, 6)]),
      added: 0,
      removed: 1,
      hunks: [{ before: [2, 7], after: [2, 6], lines: [' line 2', ' line 3', ' line 4', '-line 5', ' line 6', ' line 7', ' line 8'] }]
    },
    {
      name: 'replaced, removals before additions',
      before: text(['a', 'b', 'c']),
      after: text(['a', 'B', 'c']),
      added: 1,
      removed: 1,
      hunks: [{ before: [1, 3], after: [1, 3], lines: [' a', '-b', '+B', ' c'] }]
    },
    {
      name: 'two changes far apart, two hunks',
      before: text(lines(20)),
      after: text(lines(20).map((line, index) => (index === 1 || index === 17 ? `${line}!` : line))),
      added: 2,
      removed: 2,
      hunks: [
        { before: [1, 5], after: [1, 5], lines: [' line 1', '-line 2', '+line 2!', ' line 3', ' line 4', ' line 5'] },
        { before: [15, 6], after: [15, 6], lines: [' line 15', ' line 16', ' line 17', '-line 18', '+line 18!', ' line 19', ' line 20'] }
      ]
    },
    {
      name: 'two changes close together, one hunk',
      before: text(lines(10)),
      after: text(lines(10).map((line, index) => (index === 2 || index === 7 ? `${line}!` : line))),
      added: 2,
      removed: 2,
      hunks: [
        {
          before: [1, 10],
          after: [1, 10],
          lines: [' line 1', ' line 2', '-line 3', '+line 3!', ' line 4', ' line 5', ' line 6', ' line 7', '-line 8', '+line 8!', ' line 9', ' line 10']
        }
      ]
    },
    {
      name: 'a final line break added',
      before: 'a\nb',
      after: 'a\nb\n',
      added: 1,
      removed: 1,
      hunks: [{ before: [1, 2], after: [1, 2], lines: [' a', '-b', '\\', '+b'] }]
    },
    {
      name: 'a line added after a last line with no break',
      before: 'a',
      after: 'a\nb',
      added: 2,
      removed: 1,
      hunks: [{ before: [1, 1], after: [1, 2], lines: ['-a', '\\', '+a', '+b', '\\'] }]
    },
    {
      name: 'unchanged last line with no break, shown once marked',
      before: 'a\nb\nc',
      after: 'A\nb\nc',
      added: 1,
      removed: 1,
      hunks: [{ before: [1, 3], after: [1, 3], lines: ['-a', '+A', ' b', ' c', '\\'] }]
    }
  ]

  for (const { name, before, after, added, removed, hunks } of cases) {
    it(name, () => {
      const diff = diffText(before, after)
      expect({ added: diff.added, removed: diff.removed }).toEqual({ added, removed })
      expect(
        diff.hunks.map((hunk) => ({ before: [hunk.before.start, hunk.before.count], after: [hunk.after.start, hunk.after.count], lines: hunk.lines }))
      ).toEqual(hunks)
      expect(countChanges(before, after)).toEqual({ added, removed })
      expect(diff.cut).toBe(false)
    })
  }

  it('sets line endings aside, and says when they are all that changed', () => {
    const crlf = 'one\r\ntwo\r\nthree\r\n'
    const lf = 'one\ntwo\nthree\n'
    const only = diffText(crlf, lf)
    expect(only).toMatchObject({ hunks: [], added: 0, removed: 0, endings: true })
    const both = diffText(crlf, 'one\ntwo!\nthree\n')
    expect(both).toMatchObject({ added: 1, removed: 1, endings: true })
    expect(both.hunks[0]?.lines).toEqual([' one', '-two', '+two!', ' three'])
    expect(diffText(crlf, 'one\r\ntwo!\r\nthree\r\n').endings).toBe(false)
    // One line with no break has no ending to compare.
    expect(diffText('a', 'a\n').endings).toBe(false)
  })

  it('counts the lines of each version', () => {
    expect(diffText('a\nb\n', 'a\n').lines).toEqual({ before: 2, after: 1 })
    expect(diffText('', 'a').lines).toEqual({ before: 0, after: 1 })
  })

  it('cuts a long diff at the line limit, numbering what it shows', () => {
    const diff = diffText('', text(lines(5000)))
    expect(diff.added).toBe(5000)
    expect(diff.cut).toBe(true)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.lines).toHaveLength(4000)
    expect(diff.hunks[0]?.after).toEqual({ start: 1, count: 4000 })
  })

  it('cuts at a budget of characters, which several files can share', () => {
    const diff = diffText('', text(lines(100)), { characters: 50 })
    expect(diff.cut).toBe(true)
    expect(diff.characters).toBeLessThanOrEqual(50)
    expect(diff.hunks[0]?.lines.length).toBeGreaterThan(0)
  })

  it('shows a very long line in part', () => {
    const long = 'x'.repeat(5000)
    const diff = diffText('a\n', `a\n${long}\n`)
    expect(diff.clipped).toBe(true)
    expect(diff.hunks[0]?.lines[1]).toBe(`+${'x'.repeat(2000)}`)
  })

  it('gives a diff from which the version after can be rebuilt, whatever the edits', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 60; round++) {
      // Few distinct lines, so many repeat: the case where a diff goes wrong if it is not careful.
      const before = Array.from({ length: Math.floor(random() * 40) }, () => `l${Math.floor(random() * 6)}`)
      const after = [...before]
      for (let edit = Math.floor(random() * 8); edit > 0; edit--) {
        const at = Math.floor(random() * (after.length + 1))
        if (random() < 0.5 && after.length > 0) after.splice(at, 1)
        else after.splice(at, 0, `l${Math.floor(random() * 6)}`)
      }
      const diff = diffText(text(before), text(after))
      expect(rebuild(text(before), diff.hunks)).toEqual(after)
      expect(diff.added - diff.removed).toBe(after.length - before.length)
    }
  })

  it('stays quick and right on long versions that differ everywhere', () => {
    const before = Array.from({ length: 20_000 }, (_, index) => `const value${index} = ${index}`)
    const after = before.map((line, index) => (index % 7 === 0 ? `${line} // changed` : line))
    const started = Date.now()
    const diff = diffText(text(before), text(after), { lines: 100_000, characters: 10_000_000 })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(diff.added).toBe(Math.ceil(20_000 / 7))
    expect(diff.removed).toBe(Math.ceil(20_000 / 7))
    expect(rebuild(text(before), diff.hunks)).toEqual(after)
  })

  it('shows a stretch with nothing in common as removed, then added', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `a${index % 3}`)
    const after = Array.from({ length: 3000 }, (_, index) => `b${index % 3}`)
    const diff = diffText(text(before), text(after), { lines: 100_000, characters: 10_000_000 })
    expect({ added: diff.added, removed: diff.removed }).toEqual({ added: 3000, removed: 3000 })
    expect(rebuild(text(before), diff.hunks)).toEqual(after)
  })
})

describe('what counts as text', () => {
  const cases: { name: string; bytes: number[]; text: boolean }[] = [
    { name: 'plain text', bytes: [...new TextEncoder().encode('héllo\n')], text: true },
    { name: 'empty', bytes: [], text: true },
    { name: 'a NUL byte', bytes: [104, 0, 105], text: false },
    { name: 'not UTF-8', bytes: [0xff, 0xfe, 0x41], text: false }
  ]
  for (const { name, bytes, text: expected } of cases) {
    it(name, () => {
      expect(textOf(new Uint8Array(bytes)) !== undefined).toBe(expected)
    })
  }
})
