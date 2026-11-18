import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { ComputerUse, Reach, Scope, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { createCodex } from './adapter.ts'
import { appServerArguments, shellAllowed, threadSettings } from './isolation.ts'

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
    approve: async () => ({ allow: true })
  }
  const codex = createCodex({ folder: join(root, 'codex'), log: recordingLog(), command: fake('fake-codex.ts'), env: { ...process.env, CODEX_HOME: folder() } })
  const session = codex.open({ role: 'thread', instructions: 'You are Ada.', computer: reach })
  open.push(session)
  return { session, workspace }
}

describe('Codex and files', () => {
  it('reports a change of files as a write, naming the files it made', async () => {
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
        wrote: [join(workspace, 'trip.md')]
      }
    ])
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
  it('has no command line, and a read-only sandbox, unless the whole computer may be read', () => {
    const folders: Scope = { places: [{ path: home, kind: 'folder', write: true }], computer: 'off', home }
    expect(shellAllowed(undefined)).toBe(false)
    expect(shellAllowed(folders)).toBe(false)
    expect(threadSettings({ ...base, scope: undefined })).toMatchObject({ sandbox: 'read-only', cwd: '/data/codex' })
    expect(appServerArguments([], false)).toContain('features.shell_tool=false')
    expect(appServerArguments([], true)).not.toContain('features.shell_tool=false')
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
    expect(threadSettings({ ...base, scope })).toMatchObject({
      cwd: home,
      sandbox: 'workspace-write',
      config: { sandbox_workspace_write: { writable_roots: [home], network_access: false } }
    })
  })

  it('has no sandbox when the whole computer may be changed', () => {
    expect(threadSettings({ ...base, scope: { places: [], computer: 'write' } })).toMatchObject({ sandbox: 'danger-full-access' })
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
      env: { ...process.env, CODEX_HOME: folder() }
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
        command: 'rm -rf /',
        refused: { why: 'protected', reason: expect.stringContaining('would go through') }
      },
      { action: 'run', tool: 'shell', paths: [workspace], command: 'ls', reach: 'write' }
    ])
  })
})
