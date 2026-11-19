import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ComputerUse, Scope } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { createComputer, protectedPaths } from './computer.ts'
import { absolute, expandHome, namedPath, real, within } from './paths.ts'
import { checkUse, outsideScope, reachOf } from './scope.ts'
import { systems } from './system/index.ts'

afterEach(removeFolders)

/** A computer in a temporary folder: a granted folder, a private one beside it, and a link from one to the other. */
function machine() {
  // The native call gives the long form of a Windows path (RUNNER~1 becomes runneradmin), as the code under test does.
  const root = realpathSync.native(folder())
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
    expect(await outsideScope(read(join(root, 'harness', 'x.tools.json')), scope, [join(root, 'harness')])).toContain('never reached')
    expect(await outsideScope(write(join(secret, 'b.txt')), { places: [], computer: 'read' }, [])).toContain('outside')
  })

  it('holds a command to the same boundary, by the paths it names', async () => {
    const { granted, secret } = machine()
    const scope: Scope = { places: [{ path: granted, kind: 'folder', write: true }], computer: 'off' }
    const run = (command: string, folder = granted): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [folder], command })
    expect(await checkUse(run('ls -la && cat a.txt'), scope, [])).toEqual({ ...run('ls -la && cat a.txt'), reach: 'write' })
    expect(await outsideScope(run(`ls '${secret}'`), scope, [])).toContain('outside what the person granted')
    expect(await outsideScope(run('cat ../private/b.txt'), scope, [])).toContain('outside')
    expect(await outsideScope(run('cd .. && ls'), scope, [])).toContain('outside')
    expect(await outsideScope(run('ls ~'), scope, [])).toContain('outside')
    expect(await outsideScope(run('git -C ~ status'), scope, [])).toContain('outside')
    expect(await outsideScope(run('ls; rm -rf ~'), scope, [])).toContain('outside')
    // The folder it runs in counts too.
    expect(await outsideScope(run('ls', secret), scope, [])).toContain('outside')
  })

  it('says whether every place a command names may be changed', async () => {
    const { granted, secret } = machine()
    const scope: Scope = {
      places: [
        { path: granted, kind: 'folder', write: true },
        { path: secret, kind: 'folder', write: false }
      ],
      computer: 'off'
    }
    const run = (command: string): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [granted], command })
    expect((await checkUse(run('touch new.txt'), scope, [])).reach).toBe('write')
    expect((await checkUse(run(`cp a.txt '${secret}'/`), scope, [])).reach).toBe('read')
  })

  it('names the places a command names outside its folder, each once, so what it changes there is looked for', async () => {
    const { root, granted, secret } = machine()
    const scope: Scope = { places: [{ path: root, kind: 'folder', write: true }], computer: 'off' }
    const run = (command: string): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [granted], command })
    expect((await checkUse(run('touch new.txt && cp a.txt sub/'), scope, [])).named).toBeUndefined()
    expect((await checkUse(run(`cp a.txt ../private/ && cat '${join(secret, 'b.txt')}' > ../private/b.txt`), scope, [])).named).toEqual([
      { path: secret, below: false },
      { path: join(secret, 'b.txt'), below: false }
    ])
    // Named once going through it and once not, it is gone through.
    expect((await checkUse(run('ls ../private && rm -r ../private'), scope, [])).named).toEqual([{ path: secret, below: true }])
  })

  it('never reaches a protected place, whatever was granted, by a tool or by a command', async () => {
    const { root, granted } = machine()
    const keys = join(root, 'keys')
    mkdirSync(keys)
    writeFileSync(join(keys, 'id'), 'secret')
    const scope: Scope = {
      places: [{ path: root, kind: 'folder', write: true }],
      computer: 'write',
      protected: [
        { label: 'SSH keys', path: keys },
        { label: 'KeePass databases', ending: '.kdbx' }
      ]
    }
    const run = (command: string): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [granted], command })
    expect(await checkUse(read(join(keys, 'id')), scope, [])).toMatchObject({ refused: { why: 'protected', reason: expect.stringContaining('ssh keys') } })
    expect(await outsideScope(write(join(granted, 'vault.KDBX')), scope, [])).toContain('never reached')
    expect(await outsideScope(run(`cat '${keys}'/id`), scope, [])).toContain('never reached')
    expect(await outsideScope(run(`cat '${keys}'/*`), scope, [])).toContain('never reached')
    // Going through a folder that holds one reaches it too; naming the folder alone does not.
    expect(await outsideScope(run(`grep -r password '${root}'`), scope, [])).toContain('would go through')
    expect(await outsideScope({ action: 'read', tool: 'Grep', paths: [root] }, scope, [])).toContain('would go through')
    expect(await outsideScope(run(`ls '${root}'`), scope, [])).toBeUndefined()
    expect(await outsideScope({ action: 'read', tool: 'Glob', paths: [root] }, scope, [])).toBeUndefined()
  })

  it('reaches the assistant’s folder inside the app’s data, and nothing else of it', async () => {
    const { root } = machine()
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const scope: Scope = {
      places: [{ path: workspace, kind: 'folder', write: true }],
      computer: 'write',
      protected: [{ label: 'The app’s data', path: root, except: [workspace] }]
    }
    expect(await outsideScope(write(join(workspace, 'a.md')), scope, [])).toBeUndefined()
    expect(await outsideScope(read(join(root, 'store.sqlite')), scope, [])).toContain('never reached')
  })

  it('says whether a scope reads and writes at all', () => {
    expect(reachOf({ places: [], computer: 'off' })).toEqual({ reads: false, writes: false })
    expect(reachOf({ places: [{ path: '/a', kind: 'folder', write: false }], computer: 'off' })).toEqual({ reads: true, writes: false })
    expect(reachOf({ places: [], computer: 'write' })).toEqual({ reads: true, writes: true })
  })
})

describe('paths a command names', () => {
  it('gives variables their values here, and reads a relative path from the folder the command runs in', () => {
    const env = { HOME: '/home/ada', APPDATA: '/home/ada/.data' }
    expect(namedPath(`\${HOME}/x`, '/work', env, '/home/ada')).toBe(resolve('/home/ada/x'))
    expect(namedPath(`\${APPDATA}/a.json`, '/work', env, '/home/ada')).toBe(resolve('/home/ada/.data/a.json'))
    expect(namedPath(`\${PWD}/a`, '/work', env, '/home/ada')).toBe(resolve('/work/a'))
    // An unset variable is empty, as the shell has it. (A one-letter top folder would be a drive in Git Bash.)
    expect(namedPath(`\${UNSET}/ab`, '/work', env, '/home/ada')).toBe(resolve('/ab'))
    expect(namedPath('~/Documents', '/work', env, homedir())).toBe(join(homedir(), 'Documents'))
    expect(namedPath('../b', '/work/sub', env, '/home/ada')).toBe(resolve('/work/b'))
  })

  it('reads Git Bash’s way of writing a drive on Windows, and nowhere else', () => {
    expect(systems.win32.shellPath('/c/Users/me/Documents')).toBe('C:\\Users\\me\\Documents')
    expect(systems.win32.shellPath('/cygdrive/d/x')).toBe('D:\\x')
    expect(systems.win32.shellPath('/c')).toBe('C:\\')
    expect(systems.win32.shellPath('/etc/hosts')).toBe('/etc/hosts')
    expect(systems.linux.shellPath('/c/Users')).toBe('/c/Users')
  })
})

describe('places never reached', () => {
  const where = { home: '/home/ada', env: {} }

  it.each(['win32', 'darwin', 'linux'] as const)('lists keys, browser profiles and password stores on %s', (name) => {
    const labels = [...systems[name].protectedPaths(where).map((place) => place.label)]
    expect(labels.some((label) => /Chrome/.test(label))).toBe(true)
    expect(labels.some((label) => /Firefox/.test(label))).toBe(true)
    expect(labels.some((label) => /Edge/.test(label))).toBe(true)
    expect(labels.some((label) => /Brave/.test(label))).toBe(true)
    expect(labels.some((label) => /1Password|Bitwarden/.test(label))).toBe(true)
  })

  it('keeps Windows’ credentials and macOS’s keychains', () => {
    const windows = systems.win32.protectedPaths({ home: 'C:\\Users\\ada', env: { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' } })
    expect(windows.map((place) => place.path)).toContain('C:\\Users\\ada\\AppData\\Roaming\\Microsoft\\Protect')
    expect(systems.darwin.protectedPaths(where).map((place) => place.path)).toContain('/home/ada/Library/Keychains')
  })

  it('adds those of every system and the app’s data, but for the assistant’s folder', () => {
    const all = protectedPaths({ where, data: '/data', workspace: '/data/workspace' })
    const home = (name: string) => join('/home/ada', name)
    expect(all.map((place) => place.path)).toEqual(expect.arrayContaining([home('.ssh'), home('.aws'), home('.git-credentials'), '/data']))
    expect(all.find((place) => place.path === '/data')?.except).toEqual(['/data/workspace'])
    expect(all.some((place) => place.ending === '.kdbx')).toBe(true)
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
