import { validateView } from '@repo/catalog'
import { decodeBase64, type Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { memoryWorkspace } from '../replay/memory-workspace.ts'
import { createUserSettings } from '../settings/settings.ts'
import { createScreen, type Showing } from '../views/screen.ts'
import { createBrowsing, folderPath, isAbsolute, sorted } from './browse.ts'
import { createWrittenFiles, writtenCard } from './written.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

function setup() {
  let ids = 0
  const records = memoryRecords()
  const screen = createScreen({ records, newId: () => `v${++ids}` })
  const workspace = memoryWorkspace()
  const written = createWrittenFiles({ screen, workspace, newId: () => `v${++ids}` })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  const showing = (turn: string): Showing => ({ thread: 't1', turn, focused: true })
  return { screen, workspace, written, events, showing }
}

const filesOn = (event: Event | undefined) =>
  event?.name === 'view.shown' ? ((event.view.spec.elements.files?.props ?? {}) as { files: { name: string; size: number; detail?: string }[] }).files : []

describe('the card of the files a thread writes', () => {
  it('is composed from the generic blocks, and passes the catalogue', () => {
    const workspace = memoryWorkspace()
    workspace.files.set('trips/trip.md', bytes('- passport'))
    const item = { path: 'trips/trip.md', name: 'trip.md', kind: 'file' as const, size: 10, modified: '', location: '/home/ada/workspace/trips/trip.md' }
    const card = writtenCard([item], workspace)
    expect(card.title).toBe('File written')
    expect(validateView(card.spec).ok).toBe(true)
    expect(card.spec.elements.files?.props).toEqual({
      files: [{ path: '/home/ada/workspace/trips/trip.md', name: 'trip.md', size: 10, detail: "In the assistant's folder › trips" }],
      limit: 5
    })
  })

  it('names a project’s files from its folder', () => {
    const workspace = memoryWorkspace()
    const at = (location: string) => ({ path: location, name: location.split(/[\\/]/).at(-1) ?? '', kind: 'file' as const, size: 1, modified: '', location })
    const card = writtenCard(
      [at('/home/ada/code/echo/src/ui/a.ts'), at('/home/ada/code/echo/README.md'), at('/elsewhere/b.ts')],
      workspace,
      '/home/ada/code/echo'
    )
    const { files } = (card.spec.elements.files?.props ?? { files: [] }) as { files: { detail?: string }[] }
    const details = files.map((file) => file.detail)
    expect(details).toEqual(['In echo › src › ui', 'In echo', undefined])
  })

  it('is one card a turn, brought up to date as files are written, each file once', async () => {
    const { workspace, written, events, showing } = setup()
    workspace.files.set('a.md', bytes('a'))
    workspace.files.set('b.md', bytes('bb'))
    await written.add(showing('turn-1'), ['/home/ada/workspace/a.md'])
    workspace.files.set('a.md', bytes('aaa'))
    await written.add(showing('turn-1'), ['/home/ada/workspace/b.md', '/home/ada/workspace/a.md'])

    const shown = events.filter((event) => event.name === 'view.shown')
    expect(shown).toHaveLength(2)
    expect(shown[0]?.name === 'view.shown' && shown[1]?.name === 'view.shown' && shown[0].view.id === shown[1].view.id).toBe(true)
    expect(filesOn(shown[1]).map((file) => [file.name, file.size])).toEqual([
      ['a.md', 3],
      ['b.md', 2]
    ])
    expect(shown[1]?.name === 'view.shown' && shown[1].view.title).toBe('2 files written')
  })

  it('starts a new card for the next turn, and names a file outside the folder by where it is', async () => {
    const { workspace, written, events, showing, screen } = setup()
    workspace.files.set('a.md', bytes('a'))
    workspace.elsewhere.set('/home/ada/Documents/letter.txt', bytes('Dear'))
    await written.add(showing('turn-1'), ['/home/ada/workspace/a.md'])
    await written.add(showing('turn-2'), ['/home/ada/Documents/letter.txt'])
    const ids = events.flatMap((event) => (event.name === 'view.shown' ? [event.view.id] : []))
    expect(new Set(ids).size).toBe(2)
    expect(filesOn(events.at(-1))).toEqual([{ path: '/home/ada/Documents/letter.txt', name: 'letter.txt', size: 4 }])
    expect(screen.stream()).toHaveLength(2)
  })

  it('shows nothing for a file that is not there any more', async () => {
    const { written, events, showing } = setup()
    await written.add(showing('turn-1'), ['/home/ada/workspace/gone.md'])
    expect(events).toEqual([])
  })

  it('is kept as last shown in the thread’s history', async () => {
    const { workspace, written, showing, screen } = setup()
    workspace.files.set('a.md', bytes('a'))
    workspace.files.set('b.md', bytes('b'))
    await written.add(showing('turn-1'), ['/home/ada/workspace/a.md'])
    await written.add(showing('turn-1'), ['/home/ada/workspace/b.md'])
    const history = screen.history('t1')
    expect(history).toHaveLength(1)
    expect(history[0]?.title).toBe('2 files written')
  })
})

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
