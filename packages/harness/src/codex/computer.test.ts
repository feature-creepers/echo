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
    const root = realpathSync(folder())
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
      { action: 'run', tool: 'shell', paths: [workspace], command: 'rm -rf /' },
      { action: 'run', tool: 'shell', paths: [workspace], command: 'ls' }
    ])
  })
})
