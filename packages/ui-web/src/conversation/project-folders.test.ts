import type { Place, Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { FOLDERS_OFFERED, projectFolders } from './project-folders.ts'

const topic = (id: string, folder?: string): Thread => ({
  id,
  title: id,
  kind: 'topic',
  state: 'parked',
  at: '2026-11-19T00:00:00.000Z',
  ...(folder === undefined ? {} : { folder })
})
const place = (path: string, write = true, kind: Place['kind'] = 'folder'): Place => ({ path, kind, write })

describe('the folders a project can be opened in', () => {
  const cases: { name: string; threads: Thread[]; places: Place[]; offered: [string, boolean][] }[] = [
    { name: 'nothing yet', threads: [], places: [], offered: [] },
    {
      name: "projects' folders first, the most recent first, then the folders that may be changed",
      threads: [topic('a', '/home/ada/code/echo'), topic('b'), topic('c', '/home/ada/thesis')],
      places: [place('/home/ada/accounts'), place('/home/ada/Documents', false), place('/home/ada/notes.md', true, 'file')],
      offered: [
        ['/home/ada/code/echo', true],
        ['/home/ada/thesis', true],
        ['/home/ada/accounts', false]
      ]
    },
    {
      name: 'each folder once, whatever its capitals on Windows and a separator at its end',
      threads: [topic('a', 'C:\\GitHub\\echo'), topic('b', 'c:\\github\\echo\\')],
      places: [place('C:/GitHub/echo'), place('/home/ada/Code'), place('/home/ada/code')],
      offered: [
        ['C:\\GitHub\\echo', true],
        ['/home/ada/Code', false],
        ['/home/ada/code', false]
      ]
    },
    {
      name: 'an aside has no folder of its own',
      threads: [{ ...topic('a', '/home/ada/code/echo'), kind: 'aside' }],
      places: [],
      offered: []
    }
  ]
  for (const { name, threads, places, offered } of cases) {
    it(name, () => {
      expect(projectFolders(threads, places).map((folder) => [folder.path, folder.known])).toEqual(offered)
    })
  }

  it(`offers the ${FOLDERS_OFFERED} most recent at most`, () => {
    const threads = Array.from({ length: FOLDERS_OFFERED + 3 }, (_, index) => topic(`t${index}`, `/home/ada/p${index}`))
    expect(projectFolders(threads, [])).toHaveLength(FOLDERS_OFFERED)
    expect(projectFolders(threads, [])[0]?.path).toBe('/home/ada/p0')
  })
})
