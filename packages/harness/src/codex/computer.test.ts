import { mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComputerUse, Reach, Scope, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { createCodex } from './adapter.ts'
import { appServerArguments, codexComputer, execArguments, heldAsAsked, permissionProfile, shellAllowed, threadSettings } from './isolation.ts'
import { PROFILE, sandbox } from './sandbox/index.ts'

/**
 * Codex on the computer, against the stand-in (test/fake-codex.ts). Codex is not installed where these were
 * written: they prove what the adapter does with the protocol as it is understood.
 */

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

const home = '/home/ada/workspace'
const base = { folder: '/data/codex', model: 'm', instructions: 'i' }

/** A Codex session given the computer, whose changes are all allowed. */
function onComputer() {
  const root = realpathSync.native(folder())
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const reach: Reach = {
    scope: () => ({ places: [{ path: workspace, kind: 'folder', write: true }], computer: 'read', home: workspace }),
    approve: async () => ({ allow: true, use: 'use-1' })
  }
  const codex = createCodex({ folder: join(root, 'codex'), log: recordingLog(), command: fake('fake-codex.ts'), env: { ...process.env, CODEX_HOME: folder() } })
  const session = codex.open({ role: 'thread', instructions: 'You are Ada.', computer: reach })
  open.push(session)
  return { session, workspace }
}

describe('Codex and files', () => {
  it('reports a change of files as a write, naming the files it made and the use the core allowed', async () => {
    const { session, workspace } = onComputer()
    const followed = follow(session)
    session.send('write a file')
    await followed.until('turn-end')
    const tools = followed.events.filter((event) => event.type === 'tool')
    expect(tools).toEqual([
      { type: 'tool', name: 'computer_write', phase: 'started', call: 'item-w', input: { paths: [join(workspace, 'trip.md')] } },
      {
        type: 'tool',
        name: 'computer_write',
        phase: 'ended',
        call: 'item-w',
        input: { paths: [join(workspace, 'trip.md')] },
        wrote: [join(workspace, 'trip.md')],
        use: 'use-1'
      }
    ])
  })

  it('reports each command as a call, by the line its shell was given, with what it printed and the use the core allowed', async () => {
    const { session } = onComputer()
    const followed = follow(session)
    session.send('run commands')
    await followed.until('turn-end')
    const tools = followed.events.filter((event) => event.type === 'tool')
    const listed = { type: 'tool', name: 'computer_run', call: 'item-r1', input: { command: 'ls | wc -l' } }
    const tested = { type: 'tool', name: 'computer_run', call: 'item-r2', input: { command: 'pnpm test' } }
    expect(tools).toEqual([
      { ...listed, phase: 'started' },
      { ...listed, phase: 'ended', output: '3\n', use: 'use-1' },
      { ...tested, phase: 'started' },
      { ...tested, phase: 'ended', output: 'Exit code 1\n1 failed\n', failed: true, use: 'use-1' }
    ])
    expect(followed.text()).toBe('Ran them.')
  })

  it('shows Codex the pictures handed over, by where they are, after the words', async () => {
    const { session } = onComputer()
    const followed = follow(session)
    session.send('what came with this', [
      { path: '/home/ada/inbox/photo.png', name: 'photo.png', mediaType: 'image/png', image: true },
      { path: '/home/ada/inbox/plan.pdf', name: 'plan.pdf', mediaType: 'application/pdf', image: false }
    ])
    await followed.until('turn-end')
    expect(JSON.parse(followed.text())).toEqual(['text', { localImage: '/home/ada/inbox/photo.png' }])
  })
})

describe('Codex’s sandbox, from what the person granted', () => {
  const folders: Scope = { places: [{ path: home, kind: 'folder', write: true }], computer: 'off', home }
  const confinement = { never: ['/data/codex'], caches: ['/home/ada/.cache'], programs: ['/home/ada/.local/bin', '/home/ada/.gitconfig'] }
  const held = { kind: 'granted' as const, confinement }

  it.each([
    { name: 'nothing granted', scope: undefined, holding: 'granted' as const, shell: false },
    { name: 'folders, held to them', scope: folders, holding: 'granted' as const, shell: true },
    { name: 'folders, writing held only', scope: folders, holding: 'writes' as const, shell: false },
    {
      name: 'nothing but the whole computer to read, writing held only',
      scope: { places: [], computer: 'read' } as Scope,
      holding: 'writes' as const,
      shell: true
    },
    { name: 'an empty scope', scope: { places: [], computer: 'off' } as Scope, holding: 'granted' as const, shell: false }
  ])('gives the command line for $name: $shell', ({ scope, holding, shell }) => {
    expect(shellAllowed(scope, holding)).toBe(shell)
  })

  it('has no command line, and a read-only sandbox, without access to the computer', () => {
    expect(threadSettings({ ...base, scope: undefined })).toMatchObject({ sandbox: 'read-only', cwd: '/data/codex' })
    expect(appServerArguments([], false)).toContain('features.shell_tool=false')
    expect(appServerArguments([], true)).not.toContain('features.shell_tool=false')
  })

  it('holds commands to a profile of what was granted, naming no sandbox of its own', () => {
    const scope: Scope = {
      places: [
        { path: home, kind: 'folder', write: true },
        { path: '/home/ada/Documents', kind: 'folder', write: false },
        { path: '/home/ada/inbox/plan.pdf', kind: 'file', write: false }
      ],
      computer: 'off',
      home,
      protected: [
        { label: 'SSH keys', path: '/home/ada/.ssh' },
        { label: 'KeePass databases', ending: '.kdbx' },
        { label: 'The app’s data', path: '/data', except: ['/data/workspace'] }
      ]
    }
    const settings = threadSettings({ ...base, scope, holding: held })
    expect(settings).not.toHaveProperty('sandbox')
    expect(settings).toMatchObject({ cwd: home, approvalPolicy: 'untrusted' })
    expect(settings.config).toMatchObject({
      ...sandbox.confined,
      default_permissions: PROFILE,
      permissions: {
        [PROFILE]: {
          filesystem: {
            ':minimal': 'read',
            ':tmpdir': 'write',
            '/home/ada/.local/bin': 'read',
            '/home/ada/.gitconfig': 'read',
            '/home/ada/.cache': 'write',
            [home]: 'write',
            '/home/ada/Documents': 'read',
            '/home/ada/inbox/plan.pdf': 'read',
            '/home/ada/.ssh': 'deny',
            '/data': 'deny',
            '/data/codex': 'deny'
          },
          network: { enabled: true }
        }
      }
    })
    const filesystem = (settings.config as { permissions: Record<string, { filesystem: Record<string, string> }> }).permissions[PROFILE]?.filesystem
    // Nothing beyond: not the root, and not what a place never reached reopens when only places are granted.
    expect(filesystem).not.toHaveProperty(':root')
    expect(filesystem).not.toHaveProperty('/data/workspace')
  })

  it.each([
    { computer: 'read' as const, root: 'read', reopened: 'read', documents: 'read' },
    { computer: 'write' as const, root: 'write', reopened: 'write', documents: 'write' }
  ])('lets commands $root the whole computer when it may be $computer, places never reached excepted', ({ computer, root, reopened, documents }) => {
    const scope: Scope = {
      places: [{ path: '/home/ada/Documents', kind: 'folder', write: false }],
      computer,
      protected: [{ label: 'The app’s data', path: '/data', except: ['/data/workspace'] }]
    }
    expect(permissionProfile(scope, confinement)).toMatchObject({
      permissions: { [PROFILE]: { filesystem: { ':root': root, '/data': 'deny', '/data/workspace': reopened, '/home/ada/Documents': documents } } }
    })
  })

  it('runs commands in the first folder granted, or the temporary folder, never the adapter’s own, when held to a profile', () => {
    const elsewhere: Scope = { places: [{ path: '/home/ada/Documents', kind: 'folder', write: false }], computer: 'off' }
    expect(threadSettings({ ...base, scope: elsewhere, holding: held })).toMatchObject({ cwd: '/home/ada/Documents' })
    const handed: Scope = { places: [{ path: '/home/ada/inbox/plan.pdf', kind: 'file', write: false }], computer: 'off' }
    expect(threadSettings({ ...base, scope: handed, holding: held })).toMatchObject({ cwd: tmpdir() })
  })

  it.each([
    { reported: { type: 'workspaceWrite', writableRoots: [] }, computer: 'off' as const, held: true },
    { reported: { type: 'readOnly' }, computer: 'off' as const, held: true },
    { reported: { type: 'dangerFullAccess' }, computer: 'off' as const, held: false },
    { reported: { type: 'dangerFullAccess' }, computer: 'read' as const, held: false },
    { reported: { type: 'dangerFullAccess' }, computer: 'write' as const, held: true },
    { reported: { type: 'externalSandbox' }, computer: 'off' as const, held: false },
    { reported: undefined, computer: 'off' as const, held: false }
  ])('takes a conversation reporting $reported.type with the computer $computer as held: $held', ({ reported, computer, held }) => {
    expect(heldAsAsked(reported, { places: [], computer })).toBe(held)
  })

  it('tells its sessions their tools, and whether files need the whole computer, from how the sandbox holds', () => {
    expect(codexComputer('granted')).toMatchObject({ tools: 'shell and apply_patch', write: 'apply_patch', confines: true, needs: 'grant' })
    expect(codexComputer('writes')).toMatchObject({ confines: false, needs: 'computer' })
  })

  it('writes only in the folders given to change, while reading anywhere', () => {
    const scope: Scope = {
      places: [
        { path: home, kind: 'folder', write: true },
        { path: '/home/ada/Documents', kind: 'folder', write: false }
      ],
      computer: 'read',
      home
    }
    expect(threadSettings({ ...base, scope, holding: { kind: 'writes' } })).toMatchObject({
      cwd: home,
      sandbox: 'workspace-write',
      config: { sandbox_workspace_write: { writable_roots: [home], network_access: false } }
    })
  })

  it('works in a project’s folder when it has the command line, and in its own otherwise', () => {
    const scope: Scope = { places: [{ path: '/home/ada/code/echo', kind: 'folder', write: true }], computer: 'read', home }
    expect(threadSettings({ ...base, scope, project: '/home/ada/code/echo', holding: { kind: 'writes' } })).toMatchObject({ cwd: '/home/ada/code/echo' })
    expect(threadSettings({ ...base, scope: { ...scope, computer: 'off' }, project: '/home/ada/code/echo' })).toMatchObject({ cwd: '/data/codex' })
  })

  it('reasons at the level chosen, and at the model’s default when none was', () => {
    expect(threadSettings({ ...base, effort: 'xhigh' })).toMatchObject({ config: { model_reasoning_effort: 'xhigh' } })
    expect(threadSettings(base)).not.toHaveProperty('config')
    const single = execArguments({ model: 'gpt-7-terra', effort: 'high', instructions: 'i.txt', answer: 'a.txt' })
    expect(single.join(' ')).toContain('-c model_reasoning_effort="high"')
    expect(execArguments({ model: 'gpt-7-terra', instructions: 'i.txt', answer: 'a.txt' }).join(' ')).not.toContain('model_reasoning_effort')
  })

  it('has no sandbox when the whole computer may be changed', () => {
    expect(threadSettings({ ...base, scope: { places: [], computer: 'write' }, holding: { kind: 'writes' } })).toMatchObject({ sandbox: 'danger-full-access' })
  })
})

describe('Codex asking to act', () => {
  it('puts a command to the core, and declines a change whose files it was not told', async () => {
    const root = realpathSync.native(folder())
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const asked: ComputerUse[] = []
    const reach: Reach = {
      scope: () => ({ places: [{ path: workspace, kind: 'folder', write: true }], computer: 'read', home: workspace }),
      approve: async (use) => {
        asked.push(use)
        return { allow: true }
      }
    }
    const codex = createCodex({
      folder: join(root, 'codex'),
      log: recordingLog(),
      command: fake('fake-codex.ts'),
      // What it asks to remove holds the adapter's own folder, on every system: `/` is not the drive's root in Git Bash.
      env: { ...process.env, CODEX_HOME: folder(), FAKE_CODEX_REMOVE: root }
    })
    const session = codex.open({ role: 'thread', instructions: 'You are Ada.', computer: reach })
    open.push(session)
    const followed = follow(session)
    session.send('command')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Decisions: accept, decline, approved. Unknown: -32601.')
    expect(asked).toEqual([
      // It would go through the adapter's own folder: refused before anyone is asked.
      {
        action: 'run',
        tool: 'shell',
        paths: [workspace],
        command: `rm -rf '${root}'`,
        refused: { why: 'protected', reason: expect.stringContaining('would go through') }
      },
      { action: 'run', tool: 'shell', paths: [workspace], command: 'ls', reach: 'write' }
    ])
  })
})
