import { describe, expect, it } from 'vitest'
import { badgeOf, extensionOf, kindOf, previewTypeOf } from './kinds.ts'
import { itemsWords, modifiedWords, sizeWords, tableRows } from './words.ts'

describe('what a file is', () => {
  it.each([
    ['trip.md', 'Markdown document', 'markdown'],
    ['photo.PNG', 'PNG image', 'image'],
    ['report.final.pdf', 'PDF document', 'pdf'],
    ['data.json', 'JSON data', 'text'],
    ['table.tsv', 'TSV table', 'csv'],
    ['budget.xlsx', 'Excel spreadsheet', 'none'],
    ['archive.weird', 'WEIRD file', 'none'],
    ['README', 'File', 'none'],
    ['.env', 'File', 'none']
  ])('%s is a %s, previewed as %s', (name, label, preview) => {
    expect(kindOf(name)).toEqual({ label, preview })
  })

  it.each([
    ['trip.md', 'md', 'md'],
    ['clip.jpeg', 'jpeg', 'jpeg'],
    ['notes.markdown', 'markdown', 'mark'],
    ['README', '', 'file'],
    ['ends.', '', 'file']
  ])('%s has the extension "%s" and the badge "%s"', (name, extension, badge) => {
    expect(extensionOf(name)).toBe(extension)
    expect(badgeOf(name)).toBe(badge)
  })

  it('previews a picture and a document with their own media types', () => {
    expect(previewTypeOf('a.jpg')).toBe('image/jpeg')
    expect(previewTypeOf('a.pdf')).toBe('application/pdf')
    expect(previewTypeOf('a.zip')).toBe('application/octet-stream')
  })
})

describe('words', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [999, '999 bytes'],
    [240_400, '240 KB'],
    [3_400_000, '3.4 MB'],
    [25_000_000, '25 MB'],
    [2_500_000_000, '2.5 GB']
  ])('say %i bytes as "%s"', (bytes, words) => {
    expect(sizeWords(bytes)).toBe(words)
  })

  it('count what a folder holds', () => {
    expect([0, 1, 12].map(itemsWords)).toEqual(['Empty', '1 item', '12 items'])
  })

  it('say when something changed as a file manager does', () => {
    const now = new Date(2026, 10, 18, 15, 0)
    expect(modifiedWords(new Date(2026, 10, 18, 9, 5).toISOString(), now, 'en-GB')).toBe('Today, 09:05')
    expect(modifiedWords(new Date(2026, 10, 17, 22, 40).toISOString(), now, 'en-GB')).toBe('Yesterday, 22:40')
    expect(modifiedWords(new Date(2026, 9, 2).toISOString(), now, 'en-GB')).toBe('2 Oct')
    expect(modifiedWords(new Date(2025, 9, 2).toISOString(), now, 'en-GB')).toBe('2 Oct 2025')
    expect(modifiedWords('not a date', now)).toBe('')
  })
})

describe('the rows of a table', () => {
  it.each([
    [
      'a,b\n1,2',
      [
        ['a', 'b'],
        ['1', '2']
      ]
    ],
    [
      'a,b\r\n1,2\r\n',
      [
        ['a', 'b'],
        ['1', '2']
      ]
    ],
    [
      'name,note\n"Smith, Ada","said ""hi"""',
      [
        ['name', 'note'],
        ['Smith, Ada', 'said "hi"']
      ]
    ],
    [
      'a,"two\nlines"\nb,c',
      [
        ['a', 'two\nlines'],
        ['b', 'c']
      ]
    ],
    ['a,,c', [['a', '', 'c']]],
    ['', []]
  ])('of %j', (text, rows) => {
    expect(tableRows(text)).toEqual(rows)
  })

  it('reads tabs for a TSV table, and stops at the limit', () => {
    expect(tableRows('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(tableRows('1\n2\n3\n4', ',', 2)).toEqual([['1'], ['2']])
  })
})
