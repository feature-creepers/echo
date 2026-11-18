import type { Scope } from '@repo/core'
import { describe, expect, it } from 'vitest'
import { sandboxSettings } from './confinement.ts'

const scope = (overrides: Partial<Scope> = {}): Scope => ({
  places: [
    { path: '/home/ada/Echo', kind: 'folder', write: true },
    { path: '/home/ada/Photos', kind: 'folder', write: false }
  ],
  computer: 'off',
  home: '/home/ada/Echo',
  protected: [
    { label: 'SSH keys', path: '/home/ada/.ssh' },
    { label: 'KeePass databases', ending: '.kdbx' },
    { label: 'The app’s own data', path: '/home/ada/.config/Echo', except: ['/home/ada/.config/Echo/workspace'] }
  ],
  ...overrides
})

const confinement = { never: ['/home/ada/.config/Echo/harness'], caches: ['/home/ada/.cache', '/tmp'] }

type Filesystem = { allowWrite: string[]; denyWrite: string[]; denyRead: string[]; allowRead?: string[] }
const filesystem = (settings: Record<string, unknown>) => (settings.sandbox as { filesystem: Filesystem }).filesystem

describe('confinement of commands by the system', () => {
  it.each([
    { name: 'only the places that may be changed, and the caches', given: scope(), writes: ['/home/ada/Echo', '/home/ada/.cache', '/tmp'] },
    { name: 'anywhere, with the whole computer to change', given: scope({ computer: 'write' }), writes: ['/'] },
    { name: 'the caches alone, with the whole computer to read', given: scope({ computer: 'read', places: [] }), writes: ['/home/ada/.cache', '/tmp'] },
    {
      name: 'nothing on Windows, whose paths the sandbox cannot read',
      given: scope({ places: [{ path: 'C:UsersadaEcho', kind: 'folder', write: true }] }),
      writes: ['/home/ada/.cache', '/tmp']
    }
  ])('lets a command change $name', ({ given, writes }) => {
    expect(filesystem(sandboxSettings(given, confinement)).allowWrite).toEqual(writes)
  })

  it('keeps the places never reached, and the adapter’s own folder, from being read or changed', () => {
    const { denyRead, denyWrite, allowRead } = filesystem(sandboxSettings(scope({ computer: 'write' }), confinement))
    expect(denyRead).toEqual(['/home/ada/.ssh', '/home/ada/.config/Echo', '/home/ada/.config/Echo/harness'])
    expect(denyWrite).toEqual(denyRead)
    // The assistant's own folder inside the app's data stays within reach.
    expect(allowRead).toEqual(['/home/ada/.config/Echo/workspace'])
  })

  it('never runs a command outside the sandbox, still asks the core for each, and leaves the network as it was', () => {
    const settings = sandboxSettings(scope(), confinement)
    expect(settings.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false })
    expect(settings.permissions).toEqual({ allow: ['WebFetch(domain:*)'] })
  })
})
