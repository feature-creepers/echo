import type { KeptCopy } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { copyWords, removalWords } from './copy-words.ts'

const thread = { id: 't1', title: 'Dark mode', project: 'C:\\Users\\Ada\\code\\echo', branch: 'echo/dark-mode' }

describe('a copy of a repository, as its row says it', () => {
  const cases: { name: string; copy: KeptCopy; title: string; under: string; removal: string }[] = [
    {
      name: 'a thread’s, clean',
      copy: { folder: 'C:\\data\\worktrees\\echo\\echo-dark-mode-0123456789abcdef', thread, size: 412_000_000 },
      title: 'echo · Dark mode',
      under: 'echo/dark-mode · 412 MB',
      removal: 'Nothing is lost. What was committed stays on the branch echo/dark-mode.'
    },
    {
      name: 'a thread’s that holds changes, its size not counted',
      copy: {
        folder: '/data/worktrees/echo/echo-dark-mode',
        thread: { ...thread, project: '/home/ada/code/echo' },
        holds: '3 files changed and not committed'
      },
      title: 'echo · Dark mode',
      under: 'echo/dark-mode',
      removal: 'This loses 3 files changed and not committed. What was committed stays on the branch echo/dark-mode.'
    },
    {
      name: 'a folder no thread names',
      copy: { folder: '/data/worktrees/echo/echo-old.gone-1a2b3c', size: 5, holds: 'files that could not be checked: it is no longer a git worktree' },
      title: 'echo-old.gone-1a2b3c',
      under: 'No thread uses it · 5 bytes',
      removal: 'This loses files that could not be checked: it is no longer a git worktree.'
    },
    {
      name: 'a folder no thread names, clean',
      copy: { folder: '/data/worktrees/echo/echo-old' },
      title: 'echo-old',
      under: 'No thread uses it',
      removal: 'Nothing is lost.'
    }
  ]
  for (const { name, copy, title, under, removal } of cases) {
    it(name, () => {
      expect(copyWords(copy)).toEqual({ title, under })
      expect(removalWords(copy)).toBe(removal)
    })
  }
})
