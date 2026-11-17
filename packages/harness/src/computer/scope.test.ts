import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ComputerUse, Scope } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { createComputer } from './computer.ts'
import { absolute, expandHome, real, within } from './paths.ts'
import { outsideScope, reachOf } from './scope.ts'

afterEach(removeFolders)

/** A computer in a temporary folder: a granted folder, a private one beside it, and a link from one to the other. */
function machine() {
  const root = realpathSync(folder())
  const granted = join(root, 'granted')
  const secret = join(root, 'private')
  mkdirSync(granted)
  mkdirSync(secret)
  writeFileSync(join(granted, 'a.txt'), 'a')
  writeFileSync(join(secret, 'b.txt'), 'b')
  // A link inside the granted folder that leads out of it, where the system allows one to be made.
  let linked = true
  try {
    symlinkSync(secret, join(granted, 'escape'), 'junction')
  } catch {
    linked = false
  }
  return { root, granted, secret, linked }
}

const read = (...paths: string[]): ComputerUse => ({ action: 'read', tool: 'Read', paths })
const write = (...paths: string[]): ComputerUse => ({ action: 'change', tool: 'Edit', paths })

describe('paths', () => {
  it('reads ~ as the home folder, and a relative path from the folder given', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/Documents')).toBe(join(homedir(), 'Documents'))
    expect(absolute('notes/a.md', join(homedir(), 'work'))).toBe(join(homedir(), 'work', 'notes', 'a.md'))
  })

  it('finds where a path that does not exist yet would be', async () => {
    const { granted } = machine()
    expect(await real(join(granted, 'new', 'file.md'))).toBe(join(granted, 'new', 'file.md'))
  })

  it('tells a place and what is inside it from what is beside it', () => {
    const base = join(homedir(), 'docs')
    expect(within(join(base, 'a', 'b.txt'), base)).toBe(true)
    expect(within(base, base)).toBe(true)
    expect(within(`${base}-old`, base)).toBe(false)
    expect(within(join(base, '..', 'other'), base)).toBe(false)
  })
})

describe('the scope', () => {
  it('lets a session read and change what it was given to, and nothing else', async () => {
    const { granted, secret } = machine()
    const scope: Scope = { places: [{ path: granted, kind: 'folder', write: true }], computer: 'off' }
    expect(await outsideScope(read(join(granted, 'a.txt')), scope, [])).toBeUndefined()
    expect(await outsideScope(write(join(granted, 'new.md')), scope, [])).toBeUndefined()
    expect(await outsideScope(read(join(secret, 'b.txt')), scope, [])).toContain('outside what the person granted')
    expect(await outsideScope(read(join(granted, '..', 'private', 'b.txt')), scope, [])).toContain('outside')
  })

  it('follows links: one inside a granted folder that leads out of it is outside', async () => {
    const { granted, linked } = machine()
    if (!linked) return
    const scope: Scope = { places: [{ path: granted, kind: 'folder', write: false }], computer: 'off' }
    expect(await outsideScope(read(join(granted, 'escape', 'b.txt')), scope, [])).toContain('outside')
  })

  it('reads but does not change what was given read only', async () => {
    const { granted } = machine()
    const scope: Scope = { places: [{ path: granted, kind: 'folder', write: false }], computer: 'off' }
    expect(await outsideScope(read(join(granted, 'a.txt')), scope, [])).toBeUndefined()
    expect(await outsideScope(write(join(granted, 'a.txt')), scope, [])).toContain('read only')
  })

  it('gives a single file and not what is beside it', async () => {
    const { granted } = machine()
    const scope: Scope = { places: [{ path: join(granted, 'a.txt'), kind: 'file', write: false }], computer: 'off' }
    expect(await outsideScope(read(join(granted, 'a.txt')), scope, [])).toBeUndefined()
    expect(await outsideScope(read(join(granted, 'other.txt')), scope, [])).toContain('outside')
  })

  it('reaches everything with the whole computer, but never the assistant’s own working files', async () => {
    const { secret, root } = machine()
    const scope: Scope = { places: [], computer: 'write' }
    expect(await outsideScope(write(join(secret, 'b.txt')), scope, [])).toBeUndefined()
    expect(await outsideScope(read(join(root, 'harness', 'x.tools.json')), scope, [join(root, 'harness')])).toContain('belongs to the assistant')
    expect(await outsideScope(write(join(secret, 'b.txt')), { places: [], computer: 'read' }, [])).toContain('outside')
  })

  it('leaves commands to the person’s approval: they can reach anything', async () => {
    expect(await outsideScope({ action: 'run', tool: 'Bash', paths: ['/'], command: 'ls' }, { places: [], computer: 'off' }, [])).toBeUndefined()
  })

  it('says whether a scope reads and writes at all', () => {
    expect(reachOf({ places: [], computer: 'off' })).toEqual({ reads: false, writes: false })
    expect(reachOf({ places: [{ path: '/a', kind: 'folder', write: false }], computer: 'off' })).toEqual({ reads: true, writes: false })
    expect(reachOf({ places: [], computer: 'write' })).toEqual({ reads: true, writes: true })
  })
})

describe('the computer', () => {
  it('makes the assistant’s own folder, and says what is at a path', async () => {
    const { root, granted } = machine()
    const computer = await createComputer({ workspace: join(root, 'workspace') })
    expect(await computer.locate(join(root, 'workspace'))).toEqual({ path: join(root, 'workspace'), kind: 'folder' })
    expect(await computer.locate(join(granted, 'a.txt'))).toEqual({ path: join(granted, 'a.txt'), kind: 'file' })
    expect(await computer.locate(join(root, 'nothing'))).toBeUndefined()
  })
})
