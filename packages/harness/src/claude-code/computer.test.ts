import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ComputerUse, Reach, Scope, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { eventually, fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { system } from '../computer/system/index.ts'
import { createClaudeCode } from './adapter.ts'
import { computerTools, useOf } from './computer-tools.ts'

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

/** A session given the computer: a home folder, a granted folder, and a reach that records what it is asked. */
function setup(options: { write?: boolean; refuse?: string; project?: 'granted' | 'gone'; env?: Record<string, string>; agents?: boolean } = {}) {
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
  const harness = createClaudeCode({
    folder: join(root, 'harness'),
    log: recordingLog(),
    command: fake('fake-claude.ts'),
    env: { ...process.env, ...options.env }
  })
  const project = options.project === 'granted' ? granted : options.project === 'gone' ? join(root, 'gone') : undefined
  const session = harness.open({
    role: 'thread',
    instructions: 'You are Ada.',
    computer: reach,
    ...(project ? { folder: project } : {}),
    ...(options.agents ? { agents: true } : {})
  })
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

  it('works in a project’s folder, with the assistant’s own folder at hand, and gives commands time to finish', async () => {
    const { session, home, granted } = setup({ write: true, project: 'granted' })
    const followed = follow(session)
    session.send('argv')
    await followed.until('turn-end')
    const args = JSON.parse(followed.text()) as string[]
    expect(args[args.indexOf('--add-dir') + 1]).toBe(home)
    expect(args.filter((arg) => arg === '--add-dir')).toHaveLength(1)

    session.send('folder')
    await followed.until('turn-end', 2)
    expect(followed.text()).toContain(granted)

    session.send('environment')
    await followed.until('turn-end', 3)
    expect(followed.text()).toContain('"BASH_DEFAULT_TIMEOUT_MS":"600000"')
    expect(followed.text()).toContain('"BASH_MAX_TIMEOUT_MS":"1800000"')
  })

  it('says so when a project’s folder is gone, rather than making an empty one', async () => {
    const { session, root } = setup({ project: 'gone' })
    const followed = follow(session)
    session.send('argv')
    await followed.until('failed')
    expect(followed.events.find((event) => event.type === 'failed')).toMatchObject({ reason: expect.stringContaining(join(root, 'gone')) })
  })

  it("holds a sub-agent's uses of the computer to the same scope and questions, and reports them as the session's", async () => {
    const { session, home, asked } = setup({ agents: true })
    writeFileSync(join(home, 'notes.txt'), 'notes')
    const followed = follow(session)
    session.send('delegate read')
    await followed.until('turn-end')

    expect(followed.text()).toBe('The sub-agent was allowed.')
    expect(asked).toEqual([expect.objectContaining({ action: 'read', tool: 'Read', paths: [join(home, 'notes.txt')] })])
    expect(followed.outline().filter((line) => line.startsWith('tool:'))).toEqual([
      'tool:subagent:started',
      'tool:computer_read:started',
      'tool:computer_read:ended',
      'tool:subagent:ended'
    ])
  })

  it('sends every use to the permission prompt, so none runs unchecked', async () => {
    const { session } = setup()
    const followed = follow(session)
    session.send('files')
    await followed.until('turn-end')
    const settings = JSON.parse(String((JSON.parse(followed.text()) as { settings: string }).settings))
    expect(settings.autoMemoryEnabled).toBe(false)
    expect(settings.permissions.ask).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'])
  })

  it('holds its commands to the scope by the system where it can, with the places granted the only ones changed', async () => {
    const { session, home, root } = setup()
    const followed = follow(session)
    session.send('files')
    await followed.until('turn-end')
    const settings = JSON.parse(String((JSON.parse(followed.text()) as { settings: string }).settings))
    if (!system.confines) return expect(settings.sandbox).toBeUndefined()
    expect(settings.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false })
    expect(settings.sandbox.filesystem.allowWrite).toContain(home)
    // The granted folder is read only, and the adapter's own folder, which holds the session's token, is never read.
    expect(settings.sandbox.filesystem.allowWrite).not.toContain(join(root, 'granted'))
    expect(settings.sandbox.filesystem.denyRead).toContain(join(root, 'harness'))
    expect(settings.permissions.allow).toEqual(['WebFetch(domain:*)'])
  })

  it('reads back what the CLI kept of its own long outputs, and only its own session’s', async () => {
    const cli = realpathSync.native(folder())
    const own = join(cli, 'projects', 'C--work', 'fake-session', 'tool-results')
    const other = join(cli, 'projects', 'C--work', 'another-session', 'tool-results')
    for (const place of [own, other]) {
      mkdirSync(place, { recursive: true })
      writeFileSync(join(place, 'output.txt'), 'long')
    }
    const { session, asked } = setup({ env: { CLAUDE_CONFIG_DIR: cli } })
    const followed = follow(session)
    // The CLI says who it is before the first turn: the session's identifier comes with it.
    session.send('hello')
    await followed.until('turn-end')
    session.send(`use Read ${JSON.stringify({ file_path: join(own, 'output.txt') })}`)
    await followed.until('turn-end', 2)
    expect(asked).toEqual([{ action: 'read', tool: 'Read', paths: [join(own, 'output.txt')] }])

    session.send(`use Read ${JSON.stringify({ file_path: join(other, 'output.txt') })}`)
    await followed.until('turn-end', 3)
    expect(followed.text()).toContain('outside what the person granted')
    expect(asked).toHaveLength(1)
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
    // As written, for the check to follow each link before a `..`.
    expect(use?.paths.map((path) => resolve(path))).toEqual([base, join(base, '..', '..')])
    const elsewhere = realpathSync.native(folder())
    const anywhere = await useOf('Glob', { pattern: `${elsewhere}/**/*.conf`, path: base }, base)
    expect(anywhere?.paths.map((path) => resolve(path))).toEqual([base, elsewhere])
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
