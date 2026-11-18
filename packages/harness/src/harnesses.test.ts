import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, follow, recordingLog, removeFolders } from '../test/sessions.ts'
import { createClaudeCode, createCodex, createHarnesses } from './index.ts'

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

describe('the harnesses', () => {
  it('are Claude Code and Codex, each known by its id', () => {
    const harnesses = createHarnesses({ folder: folder(), log: recordingLog() })
    expect(harnesses.map((harness) => [harness.id, harness.name])).toEqual([
      ['claude-code', 'Claude Code'],
      ['codex', 'Codex']
    ])
  })

  it('create nothing on the machine until they are used', () => {
    const at = join(folder(), 'not', 'created')
    createHarnesses({ folder: at, log: recordingLog(), models: { codex: { thread: 'a-model' } } })
    expect(existsSync(at)).toBe(false)
  })

  // On macOS and Windows there is always a terminal, and this would open it.
  it.runIf(process.platform === 'linux')('tell the user what to type when no terminal can be opened for the sign-in', async () => {
    const nothingInstalled = { PATH: folder() }
    const claude = createClaudeCode({ folder: folder(), log: recordingLog(), command: ['/opt/claude', '--flag'], env: nothingInstalled })
    const codex = createCodex({
      folder: folder(),
      log: recordingLog(),
      command: ['/opt/codex'],
      env: { ...nothingInstalled, CODEX_HOME: '/home/ada/other codex' }
    })

    await expect(claude.signIn()).rejects.toThrow('No terminal program was found. Run "/opt/claude --flag auth login" in a terminal.')
    await expect(codex.signIn()).rejects.toThrow(`No terminal program was found. Run "env 'CODEX_HOME=/home/ada/other codex' /opt/codex login" in a terminal.`)
  })

  it('run side by side, each on its own CLI', async () => {
    const claude = createClaudeCode({ folder: folder(), log: recordingLog(), command: fake('fake-claude.ts'), env: process.env })
    const codex = createCodex({ folder: folder(), log: recordingLog(), command: fake('fake-codex.ts'), env: { ...process.env, CODEX_HOME: folder() } })
    const sessions = [claude, codex].map((harness) => harness.open({ role: 'thread', instructions: 'You are Ada.' }))
    open.push(...sessions)
    const followed = sessions.map(follow)
    for (const session of sessions) session.send('hi')
    await Promise.all(followed.map((events) => events.until('turn-end')))

    expect(followed.map((events) => events.text())).toEqual(['You said: hi', 'You said: hi'])
  })
})
