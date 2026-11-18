import type { AccessUse, Step } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { commandOf, stepSummary, stepTitle } from './steps.ts'

const step = (tool: string, input?: unknown, output?: string): Step => ({
  call: 'c',
  turn: 't',
  tool,
  at: '2026-11-18T10:00:00Z',
  ...(input === undefined ? {} : { input }),
  ...(output === undefined ? {} : { output })
})
const relative = (path: string) => (path === '/home/ada/atlas' ? '.' : path.replace('/home/ada/atlas/', ''))
const use = (action: AccessUse['action'], changes = 1): AccessUse => ({
  id: 'u',
  at: '2026-11-18T10:00:00Z',
  tool: 'Write',
  action,
  paths: [],
  decision: 'ran',
  reason: 'level',
  changes: Array.from({ length: changes }, (_, index) => ({ path: `/f${index}`, status: 'changed' as const, added: 1, removed: 0 }))
})

describe('the words for a step', () => {
  const cases: { name: string; step: Step; use?: AccessUse; title: string; summary: string | undefined }[] = [
    { name: 'a file read', step: step('computer_read', { file_path: '/home/ada/atlas/src/a.ts' }), title: 'Read a file', summary: 'src/a.ts' },
    { name: 'a search', step: step('computer_search', { pattern: 'TODO', path: '/home/ada/atlas/src' }), title: 'Searched files', summary: 'TODO in src' },
    { name: 'a glob with no folder', step: step('computer_search', { pattern: '**/*.md' }), title: 'Searched files', summary: '**/*.md' },
    { name: 'a search of the folder itself', step: step('computer_search', { pattern: '*', path: '/home/ada/atlas' }), title: 'Searched files', summary: '*' },
    {
      name: 'a file created',
      step: step('computer_write', { file_path: '/home/ada/atlas/notes.md', content: 'x' }),
      use: use('create'),
      title: 'Created a file',
      summary: 'notes.md'
    },
    {
      name: 'an edit, before its use is known',
      step: step('computer_write', { file_path: '/home/ada/atlas/a.ts', old_string: 'a', new_string: 'b' }),
      title: 'Changed a file',
      summary: 'a.ts'
    },
    {
      name: 'a change of several files, as Codex makes one',
      step: step('computer_write', { paths: ['/home/ada/atlas/a.ts', '/home/ada/atlas/b.ts', '/home/ada/atlas/c.ts'] }),
      use: use('change', 3),
      title: 'Changed 3 files',
      summary: 'a.ts and 2 more'
    },
    { name: 'a command, by its first line', step: step('computer_run', { command: 'pnpm test\necho done' }), title: 'Ran a command', summary: 'pnpm test' },
    { name: 'a page opened', step: step('browser_open', { url: 'https://example.com' }), title: 'Opened a page', summary: 'https://example.com' },
    {
      name: 'a click, by what it clicked',
      step: step('browser_click', { ref: 'e12' }, 'Clicked “Add to cart”.\nWhat is new on the page:'),
      title: 'Clicked',
      summary: '“Add to cart”'
    },
    { name: 'typing, then Enter', step: step('browser_type', { ref: 'e3', text: 'risotto', submit: true }), title: 'Typed', summary: '“risotto”, then Enter' },
    { name: 'a key', step: step('browser_press', { key: 'Escape' }), title: 'Pressed a key', summary: 'Escape' },
    { name: 'a look at the page says no more', step: step('browser_snapshot', {}), title: 'Looked at the page', summary: undefined },
    { name: 'a tool of the core', step: step('web_search', { query: 'weather in Lyon' }), title: 'Searched the web', summary: 'weather in Lyon' },
    { name: 'a tool not known', step: step('something_new', { anything: 'here' }), title: 'something_new', summary: 'here' },
    {
      name: 'a turn passed on, never by its thread’s identifier',
      step: step('thread_send', { thread: 'a2bac25c-2fd9' }),
      title: 'Passed it to this thread',
      summary: undefined
    },
    {
      name: 'a turn passed on with words of its own',
      step: step('thread_send', { thread: 'a2bac25c-2fd9', request: 'Run the tests.' }),
      title: 'Passed it to this thread',
      summary: 'Run the tests.'
    }
  ]
  for (const { name, step: one, use: made, title, summary } of cases) {
    it(name, () => {
      expect(stepTitle(one, made)).toBe(title)
      expect(stepSummary(one, relative)).toBe(summary)
    })
  }

  it('gives a command whole, to show as it ran', () => {
    expect(commandOf(step('computer_run', { command: 'git status\ngit diff' }))).toBe('git status\ngit diff')
    expect(commandOf(step('computer_read', { file_path: '/a' }))).toBeUndefined()
  })
})
