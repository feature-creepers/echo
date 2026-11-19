import { describe, expect, it } from 'vitest'
import { badgeOf, extensionOf, kindOf, previewTypeOf } from './kinds.ts'
import { type Listing, moveFor, parentOf, type Row, visibleRows } from './tree.ts'
import { itemsWords, modifiedWords, sizeWords, tableRows, versionWords } from './words.ts'

describe('what a file is', () => {
  it.each([
    ['trip.md', 'Markdown document', 'markdown'],
    ['photo.PNG', 'PNG image', 'image'],
    ['report.final.pdf', 'PDF document', 'pdf'],
    ['data.json', 'JSON data', 'text'],
    ['table.tsv', 'TSV table', 'csv'],
    ['budget.xlsx', 'Excel spreadsheet', 'office'],
    ['plan.docx', 'Word document', 'office'],
    ['old.doc', 'Word document', 'none'],
    ['notes.odt', 'OpenDocument text', 'none'],
    ['slides.odp', 'OpenDocument presentation', 'none'],
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
  const change = { path: '/w/a.md', added: 1, removed: 0 }
  it.each([
    [{ side: 'before', tool: 'Edit' }, 'Before the assistant changed it'],
    [{ side: 'after', tool: 'Edit', change: { ...change, status: 'changed' } }, 'Changed by the assistant'],
    [{ side: 'after', tool: 'Write', change: { ...change, status: 'created' } }, 'Created by the assistant'],
    [{ side: 'after', tool: 'Bash', command: 'rm a.md', change: { ...change, status: 'deleted' } }, 'Deleted by a command'],
    [{ side: 'after', tool: 'Restore', change: { ...change, status: 'changed' } }, 'Put back by you']
  ] as const)('says what made a version: %j', (version, said) => {
    expect(versionWords(version)).toBe(said)
  })

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

describe('the folder’s tree', () => {
  const entry = (path: string, kind: 'folder' | 'file' = 'file') => ({
    path,
    name: path.split('/').at(-1) ?? path,
    kind,
    size: 0,
    modified: '',
    location: `/w/${path}`
  })
  const root = { path: '', name: 'workspace', kind: 'folder' as const, size: 3, modified: '', location: '/w' }
  const listings = new Map<string, Listing>([
    ['', { is: 'listed', folder: root, entries: [entry('inbox', 'folder'), entry('notes', 'folder'), entry('plan.md')] }],
    ['inbox', { is: 'listed', folder: entry('inbox', 'folder'), entries: [entry('inbox/2026-11-18', 'folder')] }],
    ['inbox/2026-11-18', { is: 'listed', folder: entry('inbox/2026-11-18', 'folder'), entries: [entry('inbox/2026-11-18/photo.png')] }],
    ['notes', { is: 'reading' }]
  ])
  const outline = (rows: Row[]) => rows.map((row) => `${'  '.repeat(row.depth)}${row.entry.name}${row.open ? ' (open)' : ''}${row.reading ? ' …' : ''}`)

  it('shows each open folder’s contents under it', () => {
    expect(outline(visibleRows(listings, new Set()))).toEqual(['inbox', 'notes', 'plan.md'])
    expect(outline(visibleRows(listings, new Set(['inbox', 'inbox/2026-11-18', 'notes'])))).toEqual([
      'inbox (open)',
      '  2026-11-18 (open)',
      '    photo.png',
      'notes (open) …',
      'plan.md'
    ])
  })

  it.each([
    ['ArrowDown', undefined, { to: 'inbox' }],
    ['ArrowDown', 'inbox', { to: 'inbox/2026-11-18' }],
    ['ArrowDown', 'plan.md', { to: 'plan.md' }],
    ['ArrowUp', undefined, { to: 'plan.md' }],
    ['ArrowUp', 'inbox/2026-11-18/photo.png', { to: 'inbox/2026-11-18' }],
    ['Home', 'plan.md', { to: 'inbox' }],
    ['End', 'inbox', { to: 'plan.md' }],
    ['ArrowRight', 'inbox', { to: 'inbox/2026-11-18' }],
    ['ArrowRight', 'notes', undefined],
    ['ArrowRight', 'plan.md', undefined],
    ['ArrowLeft', 'inbox/2026-11-18', { toggle: 'inbox/2026-11-18' }],
    ['ArrowLeft', 'inbox/2026-11-18/photo.png', { to: 'inbox/2026-11-18' }],
    ['ArrowLeft', 'plan.md', undefined],
    ['Enter', 'plan.md', { open: 'plan.md' }],
    ['Enter', 'inbox', { toggle: 'inbox' }],
    ['p', 'inbox', { to: 'inbox/2026-11-18/photo.png' }],
    ['P', 'inbox/2026-11-18/photo.png', { to: 'plan.md' }],
    ['z', 'inbox', undefined],
    ['Tab', 'inbox', undefined]
  ])('moves on %s from %s to %j', (key, selected, move) => {
    const rows = visibleRows(listings, new Set(['inbox', 'inbox/2026-11-18', 'notes']))
    expect(moveFor(key, rows, selected)).toEqual(move)
  })

  it('opens a closed folder on ArrowRight', () => {
    expect(moveFor('ArrowRight', visibleRows(listings, new Set()), 'inbox')).toEqual({ toggle: 'inbox' })
  })

  it('names the folder a path is in', () => {
    expect([parentOf('plan.md'), parentOf('inbox/2026-11-18/photo.png')]).toEqual(['', 'inbox/2026-11-18'])
  })
})
