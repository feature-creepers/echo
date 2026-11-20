import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { gitReads } from './git-files.ts'

afterEach(removeFolders)

/** A repository in a temporary folder, with the files given, from its work tree. `<root>` is the folder it is in. */
function repository(files: Record<string, string>) {
  const root = realpathSync.native(folder())
  const where = { home: join(root, 'home'), env: {} }
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, 'repo', path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text.replaceAll('<root>', root.replaceAll('\\', '/')))
  }
  mkdirSync(join(root, 'repo', '.git'), { recursive: true })
  return { root, where }
}

describe('the folder a repository runs its hooks from', () => {
  it.each([
    // husky's own: hooks in `.husky/_`, which call the scripts beside it.
    ['[core]\n\thooksPath = .husky/_\n', '.husky/_/post-index-change', true],
    ['[core]\n\thooksPath = .husky/_\n', '.husky/_/new/h', true],
    ['[core]\n\thooksPath = .husky/_\n', '.husky/pre-commit', false],
    ['[core]\n\thooksPath = .husky/_\n', 'src/index.ts', false],
    // As git reads its settings: capitals, a key on its section's line, quotes, comments, escapes, a line continued.
    ['[Core]\n\tHooksPath = .githooks\n', '.githooks/post-index-change', true],
    ['[core] hookspath=.githooks', '.githooks/post-index-change', true],
    ['[core]\n\thooksPath = "my hooks" ; where they are\n', 'my hooks/post-index-change', true],
    ['[core]\n\thooksPath = ./tools//hooks/\n', 'tools/hooks/post-index-change', true],
    ['[core]\n\thooksPath = \\\n\t.githooks\n', '.githooks/post-index-change', true],
    ['[core]\n\thooksPath = <root>/repo/.githooks\n', '.githooks/post-index-change', true],
    ['[core]\n\thooksPath = .one\n[user]\n\tname = Ada\n[core]\n\thooksPath = .two\n', '.one/post-index-change', true],
    // Not git's core settings, or not a value.
    ['[core "x"]\n\thooksPath = .githooks\n', '.githooks/post-index-change', false],
    ['[alias]\n\thooksPath = .githooks\n', '.githooks/post-index-change', false],
    ['[core]\n\t# hooksPath = .githooks\n', '.githooks/post-index-change', false],
    ['[core]\n\tfsmonitor = false\n', '.githooks/post-index-change', false],
    ['', '.githooks/post-index-change', false]
  ])('with the settings %j, marks a change to <repo>/%s: %s', async (settings, path, marked) => {
    const { root, where } = repository({ '.git/config': settings })
    expect(await gitReads(join(root, 'repo', path), where)).toBe(marked)
  })

  it('reads a linked work tree’s own settings, and those of the repository it shares', async () => {
    const { root, where } = repository({
      '.git/config': '[core]\n\thooksPath = .husky/_\n',
      '.git/worktrees/wt/commondir': '../..\n',
      '.git/worktrees/wt/config.worktree': '[core]\n\thooksPath = .githooks\n',
      '../wt/.git': 'gitdir: ../repo/.git/worktrees/wt\n'
    })
    const tree = join(root, 'wt')
    expect(await gitReads(join(tree, '.githooks', 'post-index-change'), where)).toBe(true)
    expect(await gitReads(join(tree, '.husky', '_', 'pre-commit'), where)).toBe(true)
    expect(await gitReads(join(tree, 'src', 'index.ts'), where)).toBe(false)
  })

  it('reads the settings of every repository around a file, a submodule’s and those of the one it is in', async () => {
    const { root, where } = repository({
      '.git/config': '[core]\n\thooksPath = vendor/lib/hooks\n',
      'vendor/lib/.git': 'gitdir: ../../.git/modules/lib\n',
      '.git/modules/lib/config': '[core]\n\thooksPath = .githooks\n'
    })
    const submodule = join(root, 'repo', 'vendor', 'lib')
    expect(await gitReads(join(submodule, 'hooks', 'post-index-change'), where)).toBe(true)
    expect(await gitReads(join(submodule, '.githooks', 'post-index-change'), where)).toBe(true)
    expect(await gitReads(join(root, 'repo', '.githooks', 'post-index-change'), where)).toBe(false)
    expect(await gitReads(join(submodule, 'src', 'a.ts'), where)).toBe(false)
  })
})
