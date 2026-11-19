import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { FoundChange } from '@repo/core'
import { afterAll, describe, expect, it } from 'vitest'
import { CHANGES_LIMIT, createSnapshots, HELD_LIMIT, porcelainPaths } from './snapshot.ts'

const folders: string[] = []
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'echo-snapshot-'))
  folders.push(made)
  return made
}
const text = (value: Uint8Array | string) => (typeof value === 'string' ? value : new TextDecoder().decode(value))
/** What a snapshot found, as text, by the file's name from the folder. */
const said = (found: { path: string; before: Uint8Array | string; after: Uint8Array | string }[], top: string) =>
  found
    .map((one) => [
      one.path
        .slice(top.length + 1)
        .split('\\')
        .join('/'),
      text(one.before),
      text(one.after)
    ])
    .sort()

const git = (top: string, ...args: string[]) =>
  execFileSync('git', ['-C', top, '-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'core.autocrlf=false', ...args])
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

describe('what git status names', () => {
  it.each([
    [' M src/a.ts\0?? notes/new file.md\0', ['src/a.ts', 'notes/new file.md']],
    ['R  b.ts\0a.ts\0 D gone.ts\0', ['b.ts', 'a.ts', 'gone.ts']],
    ['', []]
  ])('reads %j', (printed, paths) => {
    expect(porcelainPaths(printed)).toEqual(paths)
  })
})

describe('what a command changed in a folder', () => {
  it('outside git: the files it changed, created and deleted, what a large one held too large to keep', async () => {
    const top = folder()
    writeFileSync(join(top, 'notes.md'), 'a\n')
    writeFileSync(join(top, 'old.md'), 'gone\n')
    writeFileSync(join(top, 'same.md'), 'same\n')
    writeFileSync(join(top, 'large.bin'), Buffer.alloc(HELD_LIMIT + 1, 1))
    mkdirSync(join(top, 'node_modules'))
    const snapshot = await createSnapshots().snapshot(top)
    writeFileSync(join(top, 'notes.md'), 'a\nb\n')
    rmSync(join(top, 'old.md'))
    writeFileSync(join(top, 'new.md'), 'new\n')
    writeFileSync(join(top, 'large.bin'), Buffer.alloc(HELD_LIMIT + 2, 2))
    // What a program installs is not looked at.
    writeFileSync(join(top, 'node_modules', 'package.js'), 'x')
    const found = await snapshot?.changes()
    expect(found?.find((one) => one.path.endsWith('large.bin'))?.before).toBe('too-large')
    expect(
      said(
        (found ?? []).filter((one) => !one.path.endsWith('large.bin')),
        top
      )
    ).toEqual([
      ['new.md', 'none', 'new\n'],
      ['notes.md', 'a\n', 'a\nb\n'],
      ['old.md', 'gone\n', 'none']
    ])
  })

  it(`names ${CHANGES_LIMIT} files at most`, async () => {
    const top = folder()
    const snapshot = await createSnapshots().snapshot(top)
    for (let index = 0; index < CHANGES_LIMIT + 5; index++) writeFileSync(join(top, `${index}.txt`), 'x')
    expect(await snapshot?.changes()).toHaveLength(CHANGES_LIMIT)
  })

  /** What a snapshot found, as text, each file by its whole path. */
  const whole = (found: { path: string; before: Uint8Array | string; after: Uint8Array | string }[] | undefined) =>
    (found ?? []).map((one) => [one.path, text(one.before), text(one.after)]).sort()

  it('outside its folder: in the places the command names, a folder by its own files, a file alone, a path where nothing was', async () => {
    const top = folder()
    const other = folder()
    const elsewhere = folder()
    writeFileSync(join(other, 'notes.md'), 'a\n')
    mkdirSync(join(other, 'sub'))
    writeFileSync(join(other, 'sub', 'deep.md'), 'deep\n')
    writeFileSync(join(elsewhere, 'log.txt'), 'one\n')
    writeFileSync(join(elsewhere, 'untouched.txt'), 'same\n')
    const snapshot = await createSnapshots().snapshot(top, [
      { path: other, below: false },
      { path: join(elsewhere, 'log.txt'), below: false },
      { path: join(elsewhere, 'untouched.txt'), below: false },
      { path: join(elsewhere, 'made.txt'), below: false },
      { path: join(elsewhere, 'copied'), below: false }
    ])
    writeFileSync(join(top, 'here.md'), 'here\n')
    writeFileSync(join(other, 'notes.md'), 'a\nb\n')
    writeFileSync(join(other, 'copy.md'), 'c\n')
    // The command did not go through it: what its subfolders hold is not looked at.
    writeFileSync(join(other, 'sub', 'deep.md'), 'changed\n')
    writeFileSync(join(elsewhere, 'log.txt'), 'two\n')
    writeFileSync(join(elsewhere, 'made.txt'), 'made\n')
    mkdirSync(join(elsewhere, 'copied'))
    writeFileSync(join(elsewhere, 'copied', 'x.md'), 'x\n')
    expect(whole(await snapshot?.changes())).toEqual(
      [
        [join(top, 'here.md'), 'none', 'here\n'],
        [join(other, 'notes.md'), 'a\n', 'a\nb\n'],
        [join(other, 'copy.md'), 'none', 'c\n'],
        [join(elsewhere, 'log.txt'), 'one\n', 'two\n'],
        [join(elsewhere, 'made.txt'), 'none', 'made\n'],
        [join(elsewhere, 'copied', 'x.md'), 'none', 'x\n']
      ].sort()
    )
  })

  it('outside its folder: through every subfolder of a place the command goes through, and a file deleted there', async () => {
    const top = folder()
    const other = folder()
    mkdirSync(join(other, 'sub'))
    writeFileSync(join(other, 'sub', 'deep.md'), 'deep\n')
    const snapshot = await createSnapshots().snapshot(top, [{ path: other, below: true }])
    rmSync(join(other, 'sub'), { recursive: true })
    expect(whole(await snapshot?.changes())).toEqual([[join(other, 'sub', 'deep.md'), 'deep\n', 'none']])
  })

  it('looks once at a place inside the folder or named twice, and says each file once', async () => {
    const top = folder()
    writeFileSync(join(top, 'a.md'), 'a\n')
    const snapshot = await createSnapshots().snapshot(top, [
      { path: join(top, 'a.md'), below: false },
      { path: top, below: true }
    ])
    writeFileSync(join(top, 'a.md'), 'b\n')
    expect(whole(await snapshot?.changes())).toEqual([[join(top, 'a.md'), 'a\n', 'b\n']])
  })

  it.runIf(hasGit)('in a git work tree: from the commit for a file clean before, from the file for one changed before, from its top', async () => {
    const top = folder()
    git(top, 'init', '-q')
    git(top, 'config', 'core.autocrlf', 'false')
    mkdirSync(join(top, 'src'))
    writeFileSync(join(top, 'src', 'clean.ts'), 'one\n')
    writeFileSync(join(top, 'dirty.ts'), 'committed\n')
    writeFileSync(join(top, 'gone.ts'), 'bye\n')
    writeFileSync(join(top, '.gitignore'), 'built/\n')
    git(top, 'add', '.')
    git(top, 'commit', '-q', '-m', 'start')
    writeFileSync(join(top, 'dirty.ts'), 'changed before\n')
    writeFileSync(join(top, 'untouched.ts'), 'left alone\n')

    // Run from a folder inside: the whole work tree is looked at.
    const snapshot = await createSnapshots().snapshot(join(top, 'src'))
    writeFileSync(join(top, 'src', 'clean.ts'), 'one\ntwo\n')
    writeFileSync(join(top, 'dirty.ts'), 'changed by the command\n')
    rmSync(join(top, 'gone.ts'))
    writeFileSync(join(top, 'fresh.ts'), 'fresh\n')
    mkdirSync(join(top, 'built'))
    writeFileSync(join(top, 'built', 'out.js'), 'ignored\n')
    expect(said((await snapshot?.changes()) ?? [], top)).toEqual([
      ['dirty.ts', 'changed before\n', 'changed by the command\n'],
      ['fresh.ts', 'none', 'fresh\n'],
      ['gone.ts', 'bye\n', 'none'],
      ['src/clean.ts', 'one\n', 'one\ntwo\n']
    ])
  })

  it.runIf(hasGit)('in a git work tree: a commit changes no file, a checkout changes those that differ', async () => {
    const top = folder()
    git(top, 'init', '-q', '-b', 'main')
    // The work tree's own line endings, whatever this computer's git says: what git writes out is compared.
    git(top, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(top, 'a.ts'), 'main\n')
    git(top, 'add', '.')
    git(top, 'commit', '-q', '-m', 'start')
    git(top, 'checkout', '-q', '-b', 'other')
    writeFileSync(join(top, 'a.ts'), 'other\n')
    git(top, 'commit', '-q', '-am', 'other')
    git(top, 'checkout', '-q', 'main')
    writeFileSync(join(top, 'b.ts'), 'b\n')

    const snapshots = createSnapshots()
    const committing = await snapshots.snapshot(top)
    git(top, 'add', '.')
    git(top, 'commit', '-q', '-m', 'b')
    expect(await committing?.changes()).toEqual([])

    const switching = await snapshots.snapshot(top)
    git(top, 'checkout', '-q', 'other')
    expect(said((await switching?.changes()) ?? [], top)).toEqual([
      ['a.ts', 'main\n', 'other\n'],
      ['b.ts', 'b\n', 'none']
    ])
  })

  it.runIf(hasGit)('outside its folder: a place in another work tree, from the top of that tree', async () => {
    const top = folder()
    const other = folder()
    git(other, 'init', '-q')
    git(other, 'config', 'core.autocrlf', 'false')
    mkdirSync(join(other, 'docs'))
    writeFileSync(join(other, 'docs', 'a.md'), 'a\n')
    git(other, 'add', '.')
    git(other, 'commit', '-q', '-m', 'start')
    const snapshot = await createSnapshots().snapshot(top, [{ path: join(other, 'docs'), below: false }])
    writeFileSync(join(other, 'docs', 'a.md'), 'b\n')
    writeFileSync(join(other, 'beside.md'), 'beside\n')
    expect(said((await snapshot?.changes()) ?? [], other)).toEqual([
      ['beside.md', 'none', 'beside\n'],
      ['docs/a.md', 'a\n', 'b\n']
    ])
  })
})

describe('what a command changed where its line does not name', () => {
  /** What a snapshot found in a folder, as text, by the file's name from it. */
  const foundIn = (found: FoundChange[], base: string) =>
    said(
      found.filter((one) => one.path.startsWith(`${base}${sep}`)),
      base
    )
  /** A file made after the command started, as far as the system tells when a file was made. */
  const made = (path: string) => (statSync(path).birthtimeMs > 0 ? 'none' : 'unknown')

  it.each([
    ['all at once', true],
    ['one folder at a time', false]
  ])('in the places it may change, watched %s, past what programs install and the places never reached', async (_how, trees) => {
    const top = folder()
    const place = folder()
    writeFileSync(join(place, 'kept.md'), 'a\n')
    mkdirSync(join(place, 'deep', 'er'), { recursive: true })
    mkdirSync(join(place, 'node_modules'))
    const never = join(place, 'keys')
    mkdirSync(never)
    const snapshot = await createSnapshots({ trees, never: (path) => path.startsWith(never) }).snapshot(top, [], { places: [place], everywhere: false })
    writeFileSync(join(place, 'kept.md'), 'b\n')
    writeFileSync(join(place, 'deep', 'er', 'made.md'), 'new\n')
    // A folder made while it runs, and filled at once.
    mkdirSync(join(place, 'reports'))
    writeFileSync(join(place, 'reports', 'week.txt'), 'r\n')
    writeFileSync(join(place, 'node_modules', 'package.js'), 'x')
    writeFileSync(join(never, 'id_rsa'), 'k')
    // A file made and taken away again was never there.
    writeFileSync(join(place, 'brief.tmp'), 't')
    rmSync(join(place, 'brief.tmp'))
    // What its own folder holds is found by looking at it, once.
    writeFileSync(join(top, 'here.md'), 'h\n')
    const found = (await snapshot?.changes()) ?? []
    expect(foundIn(found, top)).toEqual([['here.md', 'none', 'h\n']])
    expect(foundIn(found, place)).toEqual(
      [
        ['deep/er/made.md', made(join(place, 'deep', 'er', 'made.md')), 'new\n'],
        ['kept.md', 'unknown', 'b\n'],
        ['reports/week.txt', made(join(place, 'reports', 'week.txt')), 'r\n']
      ].sort()
    )
  })

  it.runIf(hasGit)('a file there before and deleted, when git tracks it, and none that git ignores', async () => {
    const top = folder()
    const place = folder()
    git(place, 'init', '-q')
    writeFileSync(join(place, 'tracked.md'), 'a\n')
    writeFileSync(join(place, '.gitignore'), '*.log\n')
    git(place, 'add', '.')
    git(place, 'commit', '-q', '-m', 'start')
    const snapshot = await createSnapshots().snapshot(top, [], { places: [place], everywhere: false })
    rmSync(join(place, 'tracked.md'))
    writeFileSync(join(place, 'debug.log'), 'noise\n')
    expect(said((await snapshot?.changes()) ?? [], place)).toEqual([['tracked.md', 'unknown', 'none']])
  })

  it.each([
    ['all at once', true],
    ['one folder at a time', false]
  ])('the home folder when the whole computer may be changed, past the folders apps keep their data in, watched %s', async (_how, trees) => {
    const top = folder()
    const home = folder()
    for (const name of ['.config', 'AppData', 'Documents']) mkdirSync(join(home, name))
    const snapshot = await createSnapshots({ home, appData: [join(home, 'AppData')], trees }).snapshot(top, [], { places: [], everywhere: true })
    writeFileSync(join(home, '.config', 'app.json'), '{}')
    writeFileSync(join(home, 'AppData', 'cache.db'), 'x')
    writeFileSync(join(home, 'Documents', 'letter.md'), 'Dear Ada\n')
    writeFileSync(join(home, '.bashrc'), 'export A=1\n')
    expect(said((await snapshot?.changes()) ?? [], home).map(([path]) => path)).toEqual(['.bashrc', 'Documents/letter.md'])
  })

  it('watches nothing once let go', async () => {
    const top = folder()
    const place = folder()
    const snapshot = await createSnapshots().snapshot(top, [], { places: [place], everywhere: false })
    snapshot?.release?.()
    writeFileSync(join(place, 'late.md'), 'late\n')
    expect(await snapshot?.changes()).toEqual([])
  })
})
