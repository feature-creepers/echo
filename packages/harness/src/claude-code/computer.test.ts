import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ComputerUse, Reach, Scope, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { eventually, fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { createClaudeCode } from './adapter.ts'
import { computerTools, useOf } from './computer-tools.ts'

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

/** A session given the computer: a home folder, a granted folder, and a reach that records what it is asked. */
function setup(options: { write?: boolean; refuse?: string } = {}) {
  const root = realpathSync.native(folder())
  const home = join(root, 'workspace')
  const granted = join(root, 'granted')
  mkdirSync(home)
  mkdirSync(granted)
  writeFileSync(join(granted, 'a.txt'), 'a')
  const asked: ComputerUse[] = []
  const signals: AbortSignal[] = []
  let answer: (verdict: { allow: true; use?: string } | { allow: false; reason: string }) => void = () => undefined
  const scope: Scope = {
    places: [
      { path: home, kind: 'folder', write: true },
      { path: granted, kind: 'folder', write: options.write ?? false }
    ],
    computer: 'off',
    home
  }
  const reach: Reach = {
    scope: () => scope,
    approve: (use, signal) => {
      // What the adapter found beyond the scope comes refused: the core keeps it and asks nobody.
      if (use.refused) return Promise.resolve({ allow: false, reason: use.refused.reason })
      asked.push(use)
      signals.push(signal as AbortSignal)
      if (use.action === 'read') return Promise.resolve({ allow: true })
      return new Promise((resolve) => {
        answer = resolve
      })
    }
  }
  const harness = createClaudeCode({ folder: join(root, 'harness'), log: recordingLog(), command: fake('fake-claude.ts'), env: process.env })
  const session = harness.open({ role: 'thread', instructions: 'You are Ada.', computer: reach })
  open.push(session)
  return { session, home, granted, root, asked, signals, answer: (verdict: Parameters<typeof answer>[0]) => answer(verdict) }
}

describe('Claude Code on the computer', () => {
  it('is given its own tools for what was granted, works in the assistant’s folder, and is told the others', async () => {
    const { session, home, granted } = setup()
    const followed = follow(session)
    session.send('argv')
    await followed.until('turn-end')
    const args = JSON.parse(followed.text()) as string[]
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Write,Edit,Bash')
    expect(args[args.indexOf('--add-dir') + 1]).toBe(granted)
    expect(args.filter((arg) => arg === '--add-dir')).toHaveLength(1)

    session.send('folder')
    await followed.until('turn-end', 2)
    expect(followed.text()).toContain(home)
  })

  it('sends every use to the permission prompt, so none runs unchecked', async () => {
    const { session } = setup()
    const followed = follow(session)
    session.send('files')
    await followed.until('turn-end')
    const settings = JSON.parse(String((JSON.parse(followed.text()) as { settings: string }).settings))
    expect(settings).toEqual({ autoMemoryEnabled: false, permissions: { ask: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'] } })
  })

  it('reads within what was granted, and reports the use under the core’s name', async () => {
    const { session, granted, asked } = setup()
    const followed = follow(session)
    session.send(`use Read ${JSON.stringify({ file_path: join(granted, 'a.txt') })}`)
    await followed.until('turn-end')
    // Started as soon as the call begins, and again once its input has arrived.
    expect(followed.outline()).toEqual(['tool:computer_read:started', 'tool:computer_read:started', 'tool:computer_read:ended', 'text:Allowed.', 'turn-end'])
    expect(asked).toEqual([{ action: 'read', tool: 'Read', paths: [join(granted, 'a.txt')] }])
  })

  it('refuses what is outside, with the reason, without asking anyone', async () => {
    const { session, root, asked } = setup()
    const followed = follow(session)
    session.send(`use Read ${JSON.stringify({ file_path: join(root, 'harness', 'secret.tools.json') })}`)
    await followed.until('turn-end')
    expect(followed.text()).toContain('Refused:')
    expect(followed.text()).toContain('never reached')

    session.send(`use Edit ${JSON.stringify({ file_path: join(root, 'granted', 'a.txt') })}`)
    await followed.until('turn-end', 2)
    expect(followed.text()).toContain('granted it read only')
    expect(asked).toEqual([])
  })

  it('waits for the core’s answer to a change, and passes on a refusal in its words', async () => {
    const { session, home, asked, answer } = setup()
    const followed = follow(session)
    session.send(`use Write ${JSON.stringify({ file_path: join(home, 'list.md'), content: 'x' })}`)
    await eventually(() => asked.length === 1)
    expect(asked[0]).toEqual({ action: 'create', tool: 'Write', paths: [join(home, 'list.md')] })
    answer({ allow: false, reason: 'The person said no.' })
    await followed.until('turn-end')
    expect(followed.text()).toBe('Refused: The person said no.')
  })

  it('names the file it wrote, absolute, and the use the core allowed, once the change is made', async () => {
    const { session, home, answer, asked } = setup()
    const followed = follow(session)
    session.send(`use Write ${JSON.stringify({ file_path: 'trip.md', content: 'x' })}`)
    await eventually(() => asked.length === 1)
    answer({ allow: true, use: 'use-1' })
    await followed.until('turn-end')
    const ended = followed.events.filter((event) => event.type === 'tool' && event.phase === 'ended')
    expect(ended).toEqual([expect.objectContaining({ name: 'computer_write', wrote: [join(home, 'trip.md')], use: 'use-1' })])
  })

  it('names no file when a change was refused', async () => {
    const { session, home, answer, asked } = setup()
    const followed = follow(session)
    session.send(`use Edit ${JSON.stringify({ file_path: join(home, 'trip.md'), old_string: 'a', new_string: 'b' })}`)
    await eventually(() => asked.length === 1)
    answer({ allow: false, reason: 'The person said no.' })
    await followed.until('turn-end')
    const ended = followed.events.find((event) => event.type === 'tool' && event.phase === 'ended')
    expect(ended).toMatchObject({ name: 'computer_write', failed: true })
    expect(ended).not.toHaveProperty('wrote')
  })

  it('withdraws the question when the turn is interrupted', async () => {
    const { session, asked, signals } = setup()
    const followed = follow(session)
    session.send(`use Bash ${JSON.stringify({ command: 'ls -la' })}`)
    await eventually(() => asked.length === 1)
    expect(asked[0]).toMatchObject({ action: 'run', command: 'ls -la' })
    session.interrupt()
    expect(signals[0]?.aborted).toBe(true)
    await followed.until('turn-end')
  })
})

describe('the tools on the computer', () => {
  it('are none without a scope, reading for read-only places, and all with a writable one', () => {
    expect(computerTools(undefined)).toEqual([])
    expect(computerTools({ places: [], computer: 'off' })).toEqual([])
    expect(computerTools({ places: [{ path: '/a', kind: 'folder', write: false }], computer: 'off' })).toEqual(['Read', 'Glob', 'Grep'])
    expect(computerTools({ places: [], computer: 'write' })).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'])
  })

  it('name every folder a search reaches, so a pattern cannot climb out of its folder', async () => {
    const base = realpathSync.native(folder())
    const use = await useOf('Glob', { pattern: '../../**/*.key' }, base)
    expect(use?.paths).toEqual([base, join(base, '..', '..')])
    const elsewhere = realpathSync.native(folder())
    const anywhere = await useOf('Glob', { pattern: `${elsewhere}/**/*.conf`, path: base }, base)
    expect(anywhere?.paths).toEqual([base, elsewhere])
  })

  it('tell a new file from a change to one', async () => {
    const base = realpathSync.native(folder())
    writeFileSync(join(base, 'there.md'), 'x')
    expect((await useOf('Write', { file_path: join(base, 'new.md') }, base))?.action).toBe('create')
    expect((await useOf('Write', { file_path: join(base, 'there.md') }, base))?.action).toBe('change')
    expect(readFileSync(join(base, 'there.md'), 'utf8')).toBe('x')
    expect(await useOf('Task', {}, base)).toBeUndefined()
  })
})
