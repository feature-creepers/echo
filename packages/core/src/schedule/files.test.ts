import { describe, expect, it } from 'vitest'
import { manualTimers } from '../replay/manual-timers.ts'
import { createFileWatch, FILES_GAP_MS, isPartial, matchesPattern, SETTLE_MS, type WatchedJob } from './files.ts'

describe('isPartial', () => {
  it.each([
    ['report.pdf', false],
    ['Photo 2026.JPG', false],
    ['report.pdf.crdownload', true],
    ['film.mkv.part', true],
    ['Unconfirmed 123.crdownload', true],
    ['~$budget.xlsx', true],
    ['.hidden', true],
    ['.DS_Store', true],
    ['desktop.ini', true],
    ['Thumbs.db', true],
    ['notes.txt.swp', true],
    ['data.tmp', true]
  ])('%s: %s', (name, partial) => {
    expect(isPartial(name)).toBe(partial)
  })
})

describe('matchesPattern', () => {
  it.each([
    ['report.pdf', undefined, true],
    ['report.pdf', '*.pdf', true],
    ['REPORT.PDF', '*.pdf', true],
    ['report.pdf.zip', '*.pdf', false],
    ['scan-01.jpg', 'scan-??.jpg', true],
    ['scan-001.jpg', 'scan-??.jpg', false],
    ['invoice (2).pdf', 'invoice*', true],
    ['photo.png', '*.jpg, *.png', true],
    ['a+b.txt', 'a+b.txt', true],
    ['axb.txt', 'a.b.txt', false]
  ])('%s with %s: %s', (name, pattern, matches) => {
    expect(matchesPattern(name, pattern)).toBe(matches)
  })
})

/** Lets a look that waits on the file's description come to its end. */
const settled = async () => {
  for (let step = 0; step < 10; step++) await Promise.resolve()
}

function setup({ files = new Set<string>(), reachable = true } = {}) {
  const timers = manualTimers()
  const watchers = new Map<string, (paths: readonly string[]) => void>()
  const rang: { job: string; paths: readonly string[] }[] = []
  const problems: string[] = []
  const watch = createFileWatch({
    watch(folder, changed) {
      if (folder === '/gone') throw new Error('no such folder')
      watchers.set(folder, changed)
      return () => watchers.delete(folder)
    },
    fileAt: async (path) => (files.has(path) ? { size: 10 } : undefined),
    reaches: () => reachable,
    timers,
    now: () => timers.elapsed(),
    ring: (job, paths) => rang.push({ job, paths }),
    problem: (message) => problems.push(message)
  })
  const move = (folder: string, ...paths: string[]) => watchers.get(folder)?.(paths)
  const pass = async (ms: number) => {
    timers.advance(ms)
    await settled()
  }
  return { watch, watchers, rang, problems, files, move, pass }
}

const downloads: WatchedJob = { job: 'job-1', folder: '/home/ada/Downloads' }

describe('watching a folder for a job', () => {
  it('rings once the folder is quiet, with the files that arrived, and leaves out a download under way', async () => {
    const { watch, rang, files, move, pass } = setup()
    watch.follow([downloads])
    files.add('/home/ada/Downloads/report.pdf')
    move(downloads.folder, '/home/ada/Downloads/report.pdf.crdownload')
    move(downloads.folder, '/home/ada/Downloads/report.pdf')
    await pass(SETTLE_MS - 1)
    // Written again: the wait starts over.
    move(downloads.folder, '/home/ada/Downloads/report.pdf')
    await pass(SETTLE_MS - 1)
    expect(rang).toEqual([])
    await pass(1)
    expect(rang).toEqual([{ job: 'job-1', paths: ['/home/ada/Downloads/report.pdf'] }])
  })

  it('does not ring for what left the folder, for names its pattern leaves out, or for a folder no longer granted', async () => {
    const left = setup()
    left.watch.follow([downloads])
    left.move(downloads.folder, '/home/ada/Downloads/gone.pdf')
    await left.pass(SETTLE_MS)
    expect(left.rang).toEqual([])

    const named = setup({ files: new Set(['/home/ada/Downloads/a.txt']) })
    named.watch.follow([{ ...downloads, pattern: '*.pdf' }])
    named.move(downloads.folder, '/home/ada/Downloads/a.txt')
    await named.pass(SETTLE_MS)
    expect(named.rang).toEqual([])

    const ungranted = setup({ files: new Set(['/home/ada/Downloads/a.pdf']), reachable: false })
    ungranted.watch.follow([downloads])
    ungranted.move(downloads.folder, '/home/ada/Downloads/a.pdf')
    await ungranted.pass(SETTLE_MS)
    expect(ungranted.rang).toEqual([])
  })

  it('rings a job at most once a minute: what arrives meanwhile waits for the next ring', async () => {
    const { watch, rang, files, move, pass } = setup({ files: new Set(['/d/1.jpg', '/d/2.jpg', '/d/3.jpg']) })
    watch.follow([{ job: 'scans', folder: '/d' }])
    move('/d', '/d/1.jpg')
    await pass(SETTLE_MS)
    move('/d', '/d/2.jpg')
    move('/d', '/d/3.jpg')
    await pass(SETTLE_MS)
    expect(rang).toHaveLength(1)
    await pass(FILES_GAP_MS - SETTLE_MS)
    expect(rang).toEqual([
      { job: 'scans', paths: ['/d/1.jpg'] },
      { job: 'scans', paths: ['/d/2.jpg', '/d/3.jpg'] }
    ])
    expect(files.size).toBe(3)
  })

  it('stops watching a job gone or changed, and says when a folder cannot be watched', () => {
    const { watch, watchers, problems } = setup()
    watch.follow([downloads, { job: 'job-2', folder: '/gone' }])
    expect([...watchers.keys()]).toEqual([downloads.folder])
    expect(problems[0]).toContain('/gone could not be watched')
    watch.follow([{ ...downloads, folder: '/home/ada/Scans' }])
    expect([...watchers.keys()]).toEqual(['/home/ada/Scans'])
    watch.close()
    expect(watchers.size).toBe(0)
  })
})
