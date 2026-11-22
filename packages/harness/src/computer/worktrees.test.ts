import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
    // A name cut between two words ends on the word.
    await worktrees.make({ folder: top, title: 'Dark mode for the settings' })
    expect(made(place)).toContainEqual(expect.stringMatching(/^echo-dark-mode-for-the-[0-9a-f]{16}$/))
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

    await expect(worktrees.again(top, { ...copy, folder: dirname(top) })).rejects.toThrow('is not where copies are kept')
  })
})

/** A copy of a new repository with one commit of its own: nothing in it would be lost. */
const committed = async (title = 'Carry on') => {
  const top = repository()
  const { place, worktrees } = kept()
  const copy = await worktrees.make({ folder: top, title })
  if (!copy) throw new Error('No copy was made.')
  writeFileSync(join(copy.folder, 'src', 'b.ts'), 'committed in the copy\n')
  git(copy.folder, 'add', '.')
  git(copy.folder, 'commit', '-q', '-m', 'In the copy')
  return { top, place, worktrees, copy }
}

describe.runIf(hasGit)('how a copy stands', () => {
  it('says that nothing would be lost, that its work is not merged yet, and the room its files take', async () => {
    const { worktrees, copy } = await committed()
    writeFileSync(join(copy.folder, 'large.bin'), Buffer.alloc(100_000))

    expect(await worktrees.state(copy)).toMatchObject({ there: true, merged: false })
    const size = (await worktrees.size(copy.folder)) ?? 0
    // Its files, and git's own file that names its repository: no more than that.
    expect(size).toBeGreaterThanOrEqual(100_000)
    expect(size).toBeLessThan(110_000)
  })

  it('is merged once the branch it started from holds what it committed, and not before it committed anything', async () => {
    const { top, worktrees, copy } = await committed()
    const untouched = await worktrees.make({ folder: top, title: 'Untouched' })

    git(top, 'merge', '-q', '--ff-only', copy.branch)

    expect(await worktrees.state(copy)).toMatchObject({ merged: true })
    expect(untouched && (await worktrees.state(untouched))).toMatchObject({ merged: false })
  })

  it('is not there once its folder is gone', async () => {
    const { worktrees, copy } = await committed()
    rmSync(copy.folder, { recursive: true, force: true })

    expect(await worktrees.state(copy)).toEqual({ there: false })
  })
})

describe.runIf(hasGit)('removing a copy', () => {
  it('removes a clean one, and leaves its branch and the repository as they were', async () => {
    const { top, place, worktrees, copy } = await committed()

    expect(await worktrees.remove(copy.folder, false)).toEqual({ removed: true })

    expect(existsSync(copy.folder)).toBe(false)
    expect(existsSync(join(place, 'project'))).toBe(false)
    expect(branches(top)).toEqual([copy.branch, 'main'])
    expect(git(top, 'show', `${copy.branch}:src/b.ts`)).toBe('committed in the copy\n')
    expect(recorded(top)).toBe(1)
    // Its branch stays, so it comes back.
    expect(await worktrees.again(top, copy)).toBe(true)
  })

  it.each<[string, (copy: string, top: string) => void, string]>([
    ['files changed and not committed', (copy) => writeFileSync(join(copy, 'src', 'a.ts'), 'changed\n'), '1 file changed and not committed'],
    [
      'files git does not track, hidden by the person’s settings',
      (copy, top) => {
        git(top, 'config', 'status.showUntrackedFiles', 'no')
        writeFileSync(join(copy, 'notes.md'), 'new\n')
        writeFileSync(join(copy, 'more.md'), 'new\n')
      },
      '2 files changed and not committed'
    ],
    [
      'a merge under way',
      (copy, top) => {
        writeFileSync(join(top, 'src', 'b.ts'), 'committed in the project\n')
        git(top, 'add', '.')
        git(top, 'commit', '-q', '-m', 'In the project')
        try {
          git(copy, 'merge', '-q', 'main')
        } catch {
          // The two sides added the same file: the merge stops on the conflict.
        }
      },
      '1 file changed and not committed, a merge under way'
    ],
    [
      'commits that no branch holds',
      (copy) => {
        git(copy, 'checkout', '-q', '--detach')
        git(copy, 'commit', '-q', '--allow-empty', '-m', 'On no branch')
      },
      'commits that no branch holds'
    ]
  ])('keeps one that holds %s, unless told to remove it anyway', async (_case, arrange, holds) => {
    const { top, worktrees, copy } = await committed()
    arrange(copy.folder, top)

    expect(await worktrees.state(copy)).toMatchObject({ there: true, holds })
    expect(await worktrees.remove(copy.folder, false)).toEqual({ removed: false, holds })
    expect(existsSync(join(copy.folder, 'src', 'a.ts'))).toBe(true)

    expect(await worktrees.remove(copy.folder, true)).toEqual({ removed: true })
    expect(existsSync(copy.folder)).toBe(false)
    expect(branches(top)).toContain(copy.branch)
  })

  it('does not follow a link to a folder outside: what it leads to is left as it is', async () => {
    const { top, worktrees, copy } = await committed()
    const outside = join(scratch(), 'store')
    mkdirSync(outside)
    writeFileSync(join(outside, 'kept.txt'), 'kept\n')
    // As pnpm links what it installs: a folder git ignores, leading out of the copy.
    writeFileSync(join(copy.folder, '.gitignore'), '.env\nnode_modules\n')
    git(copy.folder, 'commit', '-q', '-am', 'Ignore what is installed')
    symlinkSync(outside, join(copy.folder, 'node_modules'), 'junction')

    expect(await worktrees.remove(copy.folder, false)).toEqual({ removed: true })

    expect(existsSync(copy.folder)).toBe(false)
    expect(readFileSync(join(outside, 'kept.txt'), 'utf8')).toBe('kept\n')
    expect(recorded(top)).toBe(1)
  })

  it('has nothing to do for a folder already gone', async () => {
    const { worktrees, copy } = await committed()
    rmSync(copy.folder, { recursive: true, force: true })

    expect(await worktrees.remove(copy.folder, false)).toEqual({ removed: true })
  })

  it('leaves a copy whole while a program works in it, where the system holds it', { timeout: 30_000 }, async () => {
    const { worktrees, copy } = await committed()
    const program = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { cwd: copy.folder, stdio: 'ignore' })
    await new Promise((resolve) => program.once('spawn', resolve))
    try {
      const outcome = await worktrees.remove(copy.folder, false).then(
        () => 'removed',
        (error: unknown) => String(error)
      )
      // Windows holds a folder a program works in; macOS and Linux let it go.
      if (process.platform === 'win32') {
        expect(outcome).toContain('A program still works in it.')
        expect(readFileSync(join(copy.folder, 'src', 'b.ts'), 'utf8')).toBe('committed in the copy\n')
        expect(await worktrees.state(copy)).toMatchObject({ there: true })
      } else {
        expect(outcome).toBe('removed')
        expect(existsSync(copy.folder)).toBe(false)
      }
    } finally {
      program.kill()
      await new Promise((resolve) => program.once('exit', resolve))
    }
  })
})

describe.runIf(hasGit)('folders no thread names', () => {
  it('lists a copy no thread names, with what it holds, and not those named or being made', async () => {
    const { top, place, worktrees, copy } = await committed()
    const other = await worktrees.make({ folder: top, title: 'Left behind' })
    writeFileSync(join(other?.folder ?? '', 'notes.md'), 'new\n')
    const left = join(place, 'project', 'echo-old.gone-1a2b3c')
    mkdirSync(left)
    writeFileSync(join(left, 'a.txt'), 'left\n')

    const orphans = await worktrees.orphans([copy.folder])

    expect(orphans.map((one) => [one.folder, one.holds]).sort()).toEqual(
      [
        [other?.folder, '1 file changed and not committed'],
        [left, 'files that could not be checked: it is no longer a git worktree']
      ].sort()
    )
    expect(await worktrees.size(left)).toBe(5)
    // Removed only when told to, anyway: what a folder that is no work tree holds cannot be checked.
    expect(await worktrees.remove(left, false)).toMatchObject({ removed: false })
    expect(await worktrees.remove(left, true)).toEqual({ removed: true })
    expect(existsSync(left)).toBe(false)
    expect((await worktrees.orphans([copy.folder, other?.folder ?? ''])).map((one) => one.folder)).toEqual([])
  })

  it('lists none where no copy was ever made', async () => {
    expect(await kept().worktrees.orphans([])).toEqual([])
  })
})
