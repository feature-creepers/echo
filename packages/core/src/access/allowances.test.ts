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
    ['npm install', false]
  ])('on `npm run build`, covers `%s`: %s', (line, expected) => {
    expect(covered(allowing('npm run build'), line)).toBe(expected)
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
    ['doas apt install x', false]
  ])('on `apt install`, covers `%s`: %s', (line, expected) => {
    expect(covered(allowing('apt install'), line)).toBe(expected)
  })

  it('covers a use that goes through more than was looked through by every command it runs, and a search by its tool', () => {
    const allowances = allowing()
    const line = 'grep -r token . && ls'
    const deep: ComputerUse = { ...run(line), unwalked: true }
    allowances.allow(deep, readCommand(line))
    expect(allowances.list().map((one) => one.subject)).toEqual(['grep', 'ls'])
    expect(allowances.covers(deep, readCommand(line))).toBe(true)
    const search: ComputerUse = { action: 'read', tool: 'Grep', paths: ['/home/ada/project'], unwalked: true }
    expect(allowances.covers(search, undefined)).toBe(false)
    allowances.allow(search, undefined)
    expect(allowances.covers(search, undefined)).toBe(true)
  })

  it('allows nothing for an elevated line', () => {
    expect(allowing('sudo apt install x').list()).toEqual([])
  })
})
