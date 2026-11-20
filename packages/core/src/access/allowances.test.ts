import { describe, expect, it } from 'vitest'
import type { ComputerUse } from '../ports/harness.ts'
import { createAllowances } from './allowances.ts'
import { readCommand } from './commands.ts'

const run = (command: string): ComputerUse => ({ action: 'run', tool: 'Bash', paths: ['/home/ada/project'], command })

/** Allowances with a yes for the session given to each line. */
function allowing(...lines: string[]) {
  let ids = 0
  const allowances = createAllowances({ newId: () => `a${++ids}`, now: () => new Date('2026-11-20T10:00:00Z'), destroyingAsked: () => true })
  for (const line of lines) allowances.allow(run(line), readCommand(line))
  return allowances
}

const covered = (allowances: ReturnType<typeof allowing>, line: string) => allowances.covers(run(line), readCommand(line))

describe('a yes for the session on a command', () => {
  it.each([
    ['npm run test', true],
    ['LANG=C npm run build', true],
    ['NODE_OPTIONS=x npm run build', false],
    ['env NODE_OPTIONS=x npm run build', false],
    ['npm run build --script-shell=./x.sh', false],
    ['npm --node-options=--require=./x.js run build', false],
    ['set -a; foo=1; npm run build', false],
    ['npm install', false]
  ])('on `npm run build`, covers `%s`: %s', (line, expected) => {
    expect(covered(allowing('npm run build'), line)).toBe(expected)
  })

  it.each([
    ['git commit -m x', true],
    ["git -c core.fsmonitor='./x.sh' commit -m x", false],
    ['git --config-env=core.hooksPath=HOOKS commit -m x', false],
    ['git --exec-path=./bin commit -m x', false]
  ])('on `git commit`, covers `%s`: %s', (line, expected) => {
    expect(covered(allowing('git commit -m y'), line)).toBe(expected)
  })

  it('never covers a line that exports a variable, even with export allowed', () => {
    const allowances = allowing('npm run build')
    // No line allows `export` itself, since each gives a variable: it is allowed here by hand.
    allowances.allow(run('export'), { ...readCommand('npm run build'), keys: ['export'] })
    expect(covered(allowances, 'export NODE_OPTIONS=x; npm run build')).toBe(false)
  })

  it('allows nothing for a line that gives a program a variable', () => {
    expect(allowing('NODE_OPTIONS=x npm run build').list()).toEqual([])
  })

  it.each([
    ['apt install x', true],
    ['sudo apt install x', false],
    ['doas apt install x', false],
    ['run0 apt install x', false],
    ['pkexec apt install x', false],
    ["su -c 'apt install x'", false]
  ])('on `apt install`, covers `%s`: %s', (line, expected) => {
    expect(covered(allowing('apt install'), line)).toBe(expected)
  })

  it.each([
    ['grep -r token . | sort', 'grep -r other . | sort', true, true],
    ['grep -r token . | sed s/a/b/', 'grep -r other . | sed s/x/y/', true, true],
    // A walk's yes covers only a line that would read only apart from the walk.
    ['grep -r token . | sed s/a/b/', "echo | sed '1e touch pwned'", false, false],
    ['grep -r token . | sed s/a/b/', "echo | sed '1e touch pwned'", true, false],
    ['grep -r token . | sed s/a/b/', 'sed -i s/a/b/ a.txt', false, false],
    ['grep -r token . | sed s/a/b/', 'grep -r token . > out.txt', true, false],
    ['grep -r token . | sed s/a/b/', 'grep -r token .', false, false],
    // Nor does a command's yes cover a walk.
    ['sed -i s/a/b/ a.txt', 'grep -r token . | sed s/x/y/', true, false],
    ['grep -r token . && npm run build', 'grep -r other . && npm run test', true, true],
    ['grep -r token . && npm run build', 'grep -r other .', true, true],
    ['grep -r token . && npm run build', 'npm run build', false, true]
  ] as const)('on `%s` past the walk, covers `%s` (past it: %s): %s', (allowed, line, unwalked, expected) => {
    const allowances = allowing()
    allowances.allow({ ...run(allowed), unwalked: true }, readCommand(allowed))
    expect(allowances.covers({ ...run(line), ...(unwalked ? { unwalked: true as const } : {}) }, readCommand(line))).toBe(expected)
  })

  it('keeps a walk’s yes apart from a command’s, and a search’s by its tool', () => {
    const allowances = allowing()
    allowances.allow({ ...run('grep -r token . | sed s/a/b/'), unwalked: true }, readCommand('grep -r token . | sed s/a/b/'))
    expect(allowances.list().map(({ kind, subject }) => ({ kind, subject }))).toEqual([
      { kind: 'walk', subject: 'grep' },
      { kind: 'walk', subject: 'sed' }
    ])
    const search: ComputerUse = { action: 'read', tool: 'Grep', paths: ['/home/ada/project'], unwalked: true }
    expect(allowances.covers(search, undefined)).toBe(false)
    allowances.allow(search, undefined)
    expect(allowances.covers(search, undefined)).toBe(true)
    expect(allowances.list().at(-1)).toMatchObject({ kind: 'walk', subject: 'Grep' })
  })

  it('allows nothing for an elevated line', () => {
    expect(allowing('sudo apt install x').list()).toEqual([])
  })
})
