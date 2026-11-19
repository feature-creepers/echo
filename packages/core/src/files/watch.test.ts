import { describe, expect, it } from 'vitest'
import { createFolderWatch, GATHER_MS, PATHS_TOLD, WATCHED_FOLDERS } from './watch.ts'

/** A computer whose folders change when the test says, and timers the test moves on. */
function setup(options: { timers?: boolean; refuse?: string } = {}) {
  const watching = new Map<string, (paths: readonly string[]) => void>()
  const stopped: string[] = []
  const told: string[][] = []
  const waiting: { at: number; work: () => void; cancelled: boolean }[] = []
  let clock = 0
  const timers = {
    after(ms: number, work: () => void) {
      const one = { at: clock + ms, work, cancelled: false }
      waiting.push(one)
      return () => {
        one.cancelled = true
      }
    }
  }
  const pass = (ms: number) => {
    clock += ms
    for (const one of waiting.splice(0)) {
      if (one.cancelled) continue
      if (one.at <= clock) one.work()
      else waiting.push(one)
    }
  }
  const watch = createFolderWatch({
    watch(folder, changed) {
      if (folder === options.refuse) throw new Error('ENOENT')
      watching.set(folder, changed)
      return () => {
        watching.delete(folder)
        stopped.push(folder)
      }
    },
    pathOf: (location) => (location.startsWith('/w/') ? location.slice(3) : location === '/w' ? '' : undefined),
    ...(options.timers === false ? {} : { timers }),
    changed: (paths) => told.push(paths)
  })
  const change = (folder: string, ...paths: string[]) => watching.get(folder)?.(paths)
  return { watch, watching, stopped, told, pass, change }
}

describe('the folders the person browses, watched', () => {
  it('tells a burst of changes once, by their paths in the folder, whoever made them', () => {
    const { watch, told, pass, change } = setup()
    watch.follow('/w')
    watch.follow('/w/trips')
    change('/w', '/w/report.md')
    change('/w/trips', '/w/trips/rome.md', '/w/trips/rome.md')
    change('/w', '/outside/elsewhere.md')
    expect(told).toEqual([])
    pass(GATHER_MS)
    expect(told).toEqual([['report.md', 'trips/rome.md']])
    change('/w', '/w/later.md')
    pass(GATHER_MS)
    expect(told.at(-1)).toEqual(['later.md'])
  })

  it('tells at once without timers, and nothing for a change outside the folder', () => {
    const { watch, told, change } = setup({ timers: false })
    watch.follow('/w')
    change('/w', '/outside/x')
    change('/w', '/w/a.txt')
    expect(told).toEqual([['a.txt']])
  })

  it(`names ${PATHS_TOLD} paths at most in one telling`, () => {
    const { watch, told, pass, change } = setup()
    watch.follow('/w')
    change('/w', ...Array.from({ length: PATHS_TOLD + 20 }, (_, index) => `/w/${index}.log`))
    pass(GATHER_MS)
    expect(told[0]).toHaveLength(PATHS_TOLD)
  })

  it(`watches the ${WATCHED_FOLDERS} folders listed last, each once`, () => {
    const { watch, watching, stopped } = setup()
    for (let index = 0; index < WATCHED_FOLDERS; index++) watch.follow(`/w/${index}`)
    // Listed again, the first is among the latest: the second is the one given up.
    watch.follow('/w/0')
    watch.follow('/w/new')
    expect(watching.size).toBe(WATCHED_FOLDERS)
    expect(stopped).toEqual(['/w/1'])
    expect(watching.has('/w/0')).toBe(true)
  })

  it('leaves a folder it cannot watch, and stops every watch when closed', () => {
    const { watch, watching, stopped, told, pass, change } = setup({ refuse: '/w/gone' })
    watch.follow('/w/gone')
    watch.follow('/w')
    expect([...watching.keys()]).toEqual(['/w'])
    change('/w', '/w/a.txt')
    watch.close()
    pass(GATHER_MS)
    expect(told).toEqual([])
    expect(stopped).toEqual(['/w'])
    watch.follow('/w')
    expect(watching.size).toBe(0)
  })
})
