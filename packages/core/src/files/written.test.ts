import { validateView } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { memoryWorkspace } from '../replay/memory-workspace.ts'
import { createScreen, type Showing } from '../views/screen.ts'
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
