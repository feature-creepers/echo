import { decodeBase64 } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { memoryWorkspace } from '../replay/memory-workspace.ts'
import { createUserSettings } from '../settings/settings.ts'
import { createBrowsing, folderPath, isAbsolute, sorted } from './browse.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('browsing the assistant’s folder', () => {
  const browsing = (places: { path: string; kind: 'folder' | 'file'; write: boolean }[] = []) => {
    const workspace = memoryWorkspace()
    const settings = createUserSettings(memoryRecords())
    settings.setAccess({ places })
    return { workspace, browse: createBrowsing({ workspace, settings }) }
  }

  it.each([
    ['', ''],
    ['inbox', 'inbox'],
    ['inbox/2026-11-18/', 'inbox/2026-11-18'],
    ['inbox\\2026-11-18', 'inbox/2026-11-18'],
    ['./inbox//a.txt', 'inbox/a.txt'],
    ['../secret', undefined],
    ['inbox/../../secret', undefined]
  ])('reads the path "%s" as "%s"', (given, path) => {
    expect(folderPath(given)).toBe(path)
  })

  it.each([
    ['/home/ada/a.txt', true],
    ['C:\\Users\\ada\\a.txt', true],
    ['c:/Users/ada', true],
    ['\\\\server\\share', true],
    ['inbox/a.txt', false],
    ['a:b', false]
  ])('takes "%s" as absolute: %s', (path, absolute) => {
    expect(isAbsolute(path)).toBe(absolute)
  })

  it('sorts folders first, then names as a person would', () => {
    const item = (name: string, kind: 'folder' | 'file') => ({ path: name, name, kind, size: 0, modified: '', location: name })
    expect(sorted([item('file 10.txt', 'file'), item('b', 'folder'), item('File 2.txt', 'file'), item('A', 'folder')]).map((one) => one.name)).toEqual([
      'A',
      'b',
      'File 2.txt',
      'file 10.txt'
    ])
  })

  it('lists a folder with the folder itself, leaving out what systems write by themselves', async () => {
    const { workspace, browse } = browsing()
    workspace.files.set('inbox/a.txt', bytes('a'))
    workspace.files.set('.DS_Store', bytes('x'))
    workspace.files.set('.trash/old.md', bytes('x'))
    const listed = await browse.list('')
    expect(listed.ok && listed.output.folder).toMatchObject({ path: '', kind: 'folder' })
    expect(listed.ok && listed.output.entries.map((entry) => entry.path)).toEqual(['.trash', 'inbox'])
    expect((await browse.list('../away')).ok).toBe(false)
    expect((await browse.list('nowhere')).ok).toBe(false)
  })

  it('reads a file of the folder in pieces, by its path or by where it is', async () => {
    const { workspace, browse } = browsing()
    workspace.files.set('notes.txt', bytes('abcdef'))
    const piece = await browse.read('notes.txt', 2, 3)
    expect(piece.ok && new TextDecoder().decode(decodeBase64(piece.output.data) ?? new Uint8Array())).toBe('cde')
    expect(piece.ok && piece.output.size).toBe(6)
    expect((await browse.read('/home/ada/workspace/notes.txt', 0, 10)).ok).toBe(true)
  })

  it('reads a file elsewhere only where the assistant may read', async () => {
    const { workspace, browse } = browsing([{ path: '/home/ada/Documents', kind: 'folder', write: false }])
    workspace.elsewhere.set('/home/ada/Documents/letter.txt', bytes('Dear'))
    workspace.elsewhere.set('/home/ada/.ssh/id', bytes('secret'))
    expect((await browse.read('/home/ada/Documents/letter.txt', 0, 10)).ok).toBe(true)
    expect((await browse.read('/home/ada/.ssh/id', 0, 10)).ok).toBe(false)
    expect((await browse.read('/home/ada/Documents-2/x', 0, 10)).ok).toBe(false)
  })
})
