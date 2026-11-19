import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('outside git: the files it changed, created and deleted, what a large one held unknown', async () => {
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
    expect(found?.find((one) => one.path.endsWith('large.bin'))?.before).toBe('unknown')
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
})
