import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { endingInside, matches } from './inside.ts'
import { system } from './system/index.ts'

afterEach(removeFolders)

/** A folder holding `notes.txt`, `.hidden.kdbx`, `Vault.KDBX` and `sub/old.kdb`, and a link to a folder elsewhere holding `far.opvault`. */
function tree() {
  const root = realpathSync.native(folder())
  const work = join(root, 'work')
  mkdirSync(join(work, 'sub'), { recursive: true })
  mkdirSync(join(root, 'elsewhere'))
  for (const file of ['notes.txt', '.hidden.kdbx', 'Vault.KDBX', join('sub', 'old.kdb')]) writeFileSync(join(work, file), '')
  writeFileSync(join(root, 'elsewhere', 'far.opvault'), '')
  symlinkSync(join(root, 'elsewhere'), join(work, 'link'), 'junction')
  return work
}

describe('the paths a wildcard matches', () => {
  it.each([
    ['*.txt', ['notes.txt']],
    // A name starting with a dot only when the pattern's part does, as the shell has it.
    ['*.kdbx', system.caseless ? ['Vault.KDBX'] : []],
    ['.*.kdbx', ['.hidden.kdbx']],
    ['?ault.*', ['Vault.KDBX']],
    ['sub/*.kdb', [join('sub', 'old.kdb')]],
    ['*.none', []]
  ])('matches %s with %j', async (pattern, expected) => {
    const work = tree()
    const { found, more } = await matches(work, pattern, 10)
    expect(found.sort()).toEqual(expected.map((path) => join(work, path)).sort())
    expect(more).toBe(false)
  })

  it('gives a match of an absolute brace alternative as it is', async () => {
    const work = tree()
    const notes = join(work, 'notes.txt')
    expect((await matches(join(work, 'sub'), `{${notes.replaceAll(sep, '/')},none}`, 10)).found).toEqual([notes])
  })

  it('says when there are more than it gives', async () => {
    const work = tree()
    expect(await matches(work, '*', 2)).toEqual({ found: expect.any(Array), more: true })
  })
})

describe('a file never reached, by its ending, inside a folder', () => {
  it('finds one at any depth, whatever its capitals, and not through a link', async () => {
    const work = tree()
    expect(await endingInside(work, ['.kdbx'], { left: 100 })).toEqual({ path: expect.stringMatching(/\.kdbx$/i), ending: '.kdbx' })
    expect(await endingInside(work, ['.kdb'], { left: 100 })).toEqual({ path: join(work, 'sub', 'old.kdb'), ending: '.kdb' })
    expect(await endingInside(join(work, 'sub'), ['.kdbx'], { left: 100 })).toBeUndefined()
    expect(await endingInside(join(work, 'nothing'), ['.kdbx'], { left: 100 })).toBeUndefined()
    expect(await endingInside(work, ['.opvault'], { left: 100 })).toBeUndefined()
  })

  it('stops past its budget, which the walks of one use share', async () => {
    const work = tree()
    const budget = { left: 3 }
    expect(await endingInside(work, ['.none'], budget)).toBe('unwalked')
    expect(await endingInside(join(work, 'sub'), ['.none'], budget)).toBe('unwalked')
    // Six entries in all: a budget of six looks through every one.
    expect(await endingInside(work, ['.none'], { left: 6 })).toBeUndefined()
  })
})
