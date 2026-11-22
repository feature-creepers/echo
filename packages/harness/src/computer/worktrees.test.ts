import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { eventually, folder, removeFolders } from '../../test/sessions.ts'
import { branchSlug, createWorktrees } from './worktrees.ts'

afterAll(removeFolders)

const git = (top: string, ...args: string[]) =>
  execFileSync('git', ['-C', top, '-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' })
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

/** A new folder, as the system names it whole: the temporary folder is a link on macOS, a short name on Windows. */
const scratch = () => realpathSync.native(folder())

/** A repository with one commit on `main`, named `name`, in a folder of its own. */
const repository = (name = 'project') => {
  const top = join(scratch(), name)
  mkdirSync(join(top, 'src'), { recursive: true })
  git(top, 'init', '-q', '-b', 'main')
  // Files are checked out as they were committed, whatever this computer's own git settings say.
  git(top, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(top, 'src', 'a.ts'), 'one\n')
  writeFileSync(join(top, '.gitignore'), '.env\n')
  git(top, 'add', '.')
  git(top, 'commit', '-q', '-m', 'First')
  return top
}

const head = (top: string) => git(top, 'rev-parse', 'HEAD').trim()
const branches = (top: string) => git(top, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort()
/** The work trees git records for a repository, the repository's own included. */
const recorded = (top: string) =>
  git(top, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree ')).length
/** A hook of a repository, run by git's own shell on every system. */
const hook = (top: string, name: string, script: string) => {
  const file = join(top, '.git', 'hooks', name)
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
}
/** A path as a shell script names it. */
const inShell = (path: string) => `"${path.split('\\').join('/')}"`
/** Where copies are kept in a test, and the copies. */
const kept = () => {
  const place = join(scratch(), 'worktrees')
  return { place, worktrees: createWorktrees({ folder: place }) }
}
/** The copies' folders, by their repository's name. */
const made = (place: string, name = 'project') => (existsSync(join(place, name)) ? readdirSync(join(place, name)) : [])

describe("a thread's title as a branch's name", () => {
  it.each([
    ['Fix the login page', 'fix-the-login-page'],
    ['  --Réparer: la connexion!  ', 'réparer-la-connexion'],
    ['日本語 の タイトル', '日本語-の-タイトル'],
    ['-rf /', 'rf'],
    ['...', 'work'],
    ['A'.repeat(80), 'a'.repeat(48)],
    [`${'word '.repeat(9)}words and more`, 'word-word-word-word-word-word-word-word-word-wor']
  ])('%j is %j', (title, slug) => {
    expect(branchSlug(title)).toBe(slug)
  })
})

describe.runIf(hasGit)('making a copy of a repository', () => {
  it('checks out the commit the folder is on, on a branch of its own, without what was not committed', async () => {
    const top = repository()
    writeFileSync(join(top, 'src', 'a.ts'), 'changed and not committed\n')
    writeFileSync(join(top, '.env'), 'SECRET=1\n')
    const { place, worktrees } = kept()

    const copy = await worktrees.make({ folder: top, title: 'Fix the login' })

    expect(copy).toEqual({ folder: join(place, 'project', made(place)[0] ?? ''), branch: 'echo/fix-the-login', start: { commit: head(top), branch: 'main' } })
    expect(made(place)).toEqual([expect.stringMatching(/^echo-fix-the-login-[0-9a-f]{16}$/)])
    const root = copy?.folder ?? ''
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('one\n')
    expect(existsSync(join(root, '.env'))).toBe(false)
    expect(git(root, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('echo/fix-the-login')
    // The project's own folder is left as it was: on its branch, with its changes.
    expect(git(top, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main')
    expect(readFileSync(join(top, 'src', 'a.ts'), 'utf8')).toBe('changed and not committed\n')
  })

  it('makes two copies of one repository at once, each on a branch of its own', async () => {
    const top = repository()
    const { place, worktrees } = kept()

    const copies = await Promise.all([worktrees.make({ folder: top, title: 'Same title' }), worktrees.make({ folder: top, title: 'Same title' })])

    expect(copies.map((copy) => copy?.branch).sort()).toEqual(['echo/same-title', 'echo/same-title-2'])
    expect(made(place)).toHaveLength(2)
    expect(recorded(top)).toBe(3)
    for (const copy of copies) expect(readFileSync(join(copy?.folder ?? '', 'src', 'a.ts'), 'utf8')).toBe('one\n')
  })

  it('numbers the branch when its name is taken', async () => {
    const top = repository()
    git(top, 'branch', 'echo/taken')
    const { worktrees } = kept()

    expect((await worktrees.make({ folder: top, title: 'Taken' }))?.branch).toBe('echo/taken-2')
    expect((await worktrees.make({ folder: top, title: 'Taken' }))?.branch).toBe('echo/taken-3')
  })

  it('keeps the folder of a long title short', async () => {
    const top = repository()
    const { place, worktrees } = kept()

    const copy = await worktrees.make({ folder: top, title: 'Réécrire entièrement la synchronisation des données éphémères, à la française' })

    expect([...(copy?.branch ?? '')].length).toBeLessThanOrEqual('echo/'.length + 48)
    const [name = ''] = made(place)
    expect(name).toMatch(/^echo-réécrire-entièr-[0-9a-f]{16}$/)
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(23 + 1 + 16)
  })

  it('tells apart two repositories that only share their short name', async () => {
    const [one, other] = [repository(), repository()]
    const { place, worktrees } = kept()

    const copies = [await worktrees.make({ folder: one, title: 'Same' }), await worktrees.make({ folder: other, title: 'Same' })]

    expect(copies.map((copy) => copy?.branch)).toEqual(['echo/same', 'echo/same'])
    expect(made(place)).toHaveLength(2)
    expect([recorded(one), recorded(other)]).toEqual([2, 2])
  })

  it('makes none outside a repository, or in one with no commit', async () => {
    const outside = scratch()
    const empty = join(scratch(), 'empty')
    mkdirSync(empty)
    git(empty, 'init', '-q', '-b', 'main')
    const { place, worktrees } = kept()

    expect(await worktrees.make({ folder: outside, title: 'Nothing' })).toBeUndefined()
    expect(await worktrees.make({ folder: empty, title: 'Nothing' })).toBeUndefined()
    expect([await worktrees.topOf(outside), await worktrees.topOf(empty)]).toEqual([undefined, undefined])
    expect(existsSync(place)).toBe(false)
    expect(branches(empty)).toEqual([])
  })

  it('works in a path with spaces', async () => {
    const top = repository('my own project')
    const place = join(scratch(), 'where copies are kept')
    const worktrees = createWorktrees({ folder: place })

    const copy = await worktrees.make({ folder: top, title: 'With spaces' })

    expect(dirname(copy?.folder ?? '')).toBe(join(place, 'my own project'))
    expect(readFileSync(join(copy?.folder ?? '', 'src', 'a.ts'), 'utf8')).toBe('one\n')
  })

  it('gives a project that is a folder of its repository that folder of the copy', async () => {
    const top = repository()
    const { place, worktrees } = kept()

    const copy = await worktrees.make({ folder: join(top, 'src'), title: 'Part of it' })

    expect(copy?.folder).toBe(join(place, 'project', made(place)[0] ?? '', 'src'))
    expect(await worktrees.topOf(join(top, 'src'))).toBe(top)
    // A copy is a work tree of its own: a thread at work in it is not at work in the project's.
    expect(await worktrees.topOf(copy?.folder ?? '')).toBe(join(place, 'project', made(place)[0] ?? ''))
  })

  it('names no branch it started from when the folder is on none', async () => {
    const top = repository()
    git(top, 'checkout', '-q', '--detach')
    const { worktrees } = kept()

    expect((await worktrees.make({ folder: top, title: 'Detached' }))?.start).toEqual({ commit: head(top) })
  })

  it.each([
    ['a folder never committed', (top: string) => mkdirSync(join(top, 'new')), 'new', 'never committed'],
    ['a checkout that fails', (top: string) => hook(top, 'post-checkout', 'exit 1'), '.', '']
  ])('leaves nothing behind for %s', async (_case, arrange, inside, why) => {
    const top = repository()
    arrange(top)
    const { place, worktrees } = kept()

    await expect(worktrees.make({ folder: join(top, inside), title: 'Fails' })).rejects.toThrow(why)

    expect(made(place)).toEqual([])
    expect(branches(top)).toEqual(['main'])
    expect(recorded(top)).toBe(1)
  })

  it('leaves nothing behind when it is stopped while it is made', { timeout: 30_000 }, async () => {
    const top = repository()
    const started = join(scratch(), 'started')
    hook(top, 'post-checkout', `touch ${inShell(started)}\nsleep 3`)
    const { place, worktrees } = kept()
    const stopping = new AbortController()

    const making = worktrees.make({ folder: top, title: 'Stopped' }, stopping.signal)
    await eventually(() => existsSync(started))
    stopping.abort()

    await expect(making).rejects.toThrow('It was stopped.')
    expect(made(place)).toEqual([])
    expect(branches(top)).toEqual(['main'])
    expect(recorded(top)).toBe(1)
  })
})

describe.runIf(hasGit)('having a copy there again', () => {
  const copied = async () => {
    const top = repository()
    const { place, worktrees } = kept()
    const copy = await worktrees.make({ folder: top, title: 'Carry on' })
    if (!copy) throw new Error('No copy was made.')
    writeFileSync(join(copy.folder, 'src', 'b.ts'), 'committed in the copy\n')
    git(copy.folder, 'add', '.')
    git(copy.folder, 'commit', '-q', '-m', 'In the copy')
    return { top, place, worktrees, copy }
  }

  it('leaves a copy that is there as it is', async () => {
    const { top, worktrees, copy } = await copied()
    writeFileSync(join(copy.folder, 'notes.md'), 'not committed\n')

    expect(await worktrees.again(top, copy)).toBe(false)

    expect(readFileSync(join(copy.folder, 'notes.md'), 'utf8')).toBe('not committed\n')
  })

  it('checks a copy that was removed out again from its branch, with what was committed on it', async () => {
    const { top, worktrees, copy } = await copied()
    rmSync(copy.folder, { recursive: true, force: true })

    const making: string[] = []
    expect(await worktrees.again(top, copy, undefined, () => making.push('making'))).toBe(true)

    expect(making).toEqual(['making'])
    expect(readFileSync(join(copy.folder, 'src', 'b.ts'), 'utf8')).toBe('committed in the copy\n')
    expect(git(copy.folder, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(copy.branch)
    expect(recorded(top)).toBe(2)
  })

  it('says so when its branch was deleted, and makes nothing', async () => {
    const { top, place, worktrees, copy } = await copied()
    rmSync(copy.folder, { recursive: true, force: true })
    git(top, 'worktree', 'prune')
    git(top, 'branch', '-D', copy.branch)

    await expect(worktrees.again(top, copy)).rejects.toThrow(`Its branch, ${copy.branch}, was deleted.`)
    expect(made(place)).toEqual([])
  })

  it('leaves alone a folder that holds files and is no longer a copy', async () => {
    const { top, worktrees, copy } = await copied()
    rmSync(join(copy.folder, '.git'))

    await expect(worktrees.again(top, copy)).rejects.toThrow('is no longer a copy of the project')
    expect(readFileSync(join(copy.folder, 'src', 'b.ts'), 'utf8')).toBe('committed in the copy\n')
  })

  it('refuses a folder that is not where copies are kept', async () => {
    const { top, worktrees, copy } = await copied()

    await expect(worktrees.again(top, { ...copy, folder: basename(top) === '' ? top : dirname(top) })).rejects.toThrow('is not where copies are kept')
  })
})
