import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_TURN } from '@repo/protocol'
import { afterAll, describe, expect, it } from 'vitest'
import { copiedLists, copiedPaths, readCopied } from './copied-files.ts'

describe('the files a file manager copied', () => {
  it('finds their lists on the clipboard, under their own type or as a raw format, GNOME first', async () => {
    const entry = (values: Record<string, unknown>) => ({
      types: Object.keys(values),
      getType: async (type: string) => values[type]
    })
    expect(
      await copiedLists([
        entry({ 'text/plain': '/home/ada/a.txt', 'text/uri-list': new Blob(['file:///home/ada/a.txt']) }),
        entry({ 'electron application/osclipboard;format="x-special/gnome-copied-files"': new Blob(['copy\nfile:///home/ada/a.txt']) })
      ])
    ).toEqual(['copy\nfile:///home/ada/a.txt', 'file:///home/ada/a.txt'])
    expect(await copiedLists([entry({ 'text/plain': 'hello' })])).toEqual([])
  })

  it.each([
    { name: 'GNOME', lists: ['copy\nfile:///home/ada/Photos/sea.jpg\nfile:///home/ada/Plans', ''], paths: ['/home/ada/Photos/sea.jpg', '/home/ada/Plans'] },
    { name: 'GNOME, cut', lists: ['cut\nfile:///home/ada/report.pdf'], paths: ['/home/ada/report.pdf'] },
    {
      name: 'a list of addresses, with a comment and spaces escaped',
      lists: ['', '# copied\r\nfile:///home/ada/My%20notes.md\r\nfile:///home/ada/caf%C3%A9.txt\r\n'],
      paths: ['/home/ada/My notes.md', '/home/ada/café.txt']
    },
    { name: 'the first list naming files', lists: ['copy\nfile:///a.txt', 'file:///b.txt'], paths: ['/a.txt'] },
    { name: 'each once', lists: ['file:///a.txt\nfile:///a.txt'], paths: ['/a.txt'] },
    { name: 'no files: a web address, another machine, text', lists: ['https://example.com/a.txt\nfile://server/share/a.txt', 'hello'], paths: [] },
    { name: 'nothing', lists: ['', ''], paths: [] }
  ])('reads $name', ({ lists, paths }) => {
    expect(copiedPaths(lists)).toEqual(paths)
  })

  const folder = mkdtempSync(join(tmpdir(), 'echo-copied-'))
  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('reads the files, gives the folders by where they are, and says what cannot go', async () => {
    writeFileSync(join(folder, 'note.txt'), 'hello')
    mkdirSync(join(folder, 'Plans'))
    writeFileSync(join(folder, 'film.mov'), '')
    truncateSync(join(folder, 'film.mov'), ATTACHMENT_MAX_BYTES + 1)
    const paths = copiedPaths([
      [join(folder, 'note.txt'), join(folder, 'Plans'), join(folder, 'film.mov'), join(folder, 'gone.txt')].map((path) => pathToFileURL(path).href).join('\n')
    ])
    // On Windows the addresses read back as POSIX paths, so the files are found by the paths written instead.
    const read = await readCopied(
      process.platform === 'win32' ? [join(folder, 'note.txt'), join(folder, 'Plans'), join(folder, 'film.mov'), join(folder, 'gone.txt')] : paths
    )
    expect(read.files.map((file) => [file.name, new TextDecoder().decode(file.data)])).toEqual([['note.txt', 'hello']])
    expect(read.folders).toEqual([{ name: 'Plans', path: join(folder, 'Plans') }])
    expect(read.tooLarge).toEqual(['film.mov'])
    expect(read.more).toBe(0)
  })

  it(`takes ${ATTACHMENTS_PER_TURN} at most, and counts the others`, async () => {
    const many = Array.from({ length: ATTACHMENTS_PER_TURN + 2 }, (_, index) => join(folder, `${index}.txt`))
    for (const path of many) writeFileSync(path, 'x')
    const read = await readCopied(many)
    expect(read.files).toHaveLength(ATTACHMENTS_PER_TURN)
    expect(read.more).toBe(2)
  })
})
