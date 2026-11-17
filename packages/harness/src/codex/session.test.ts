import { existsSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness, Role, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { type Cli, NotInstalled } from '../process/cli.ts'
import type { Environment } from '../process/environment.ts'
import { createCodex } from './adapter.ts'
import { openSession } from './session.ts'
import { NOT_INSTALLED } from './status.ts'

/**
 * These tests run the adapter against a stand-in for Codex (test/fake-codex.ts). They prove what the
 * adapter does with the protocol as it was understood, not that Codex speaks it that way.
 */

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

/** A Codex home of its own, so that the tests never read the settings of whoever runs them. */
function home(files: Record<string, string> = {}): string {
  const at = folder()
  for (const [name, content] of Object.entries(files)) writeFileSync(join(at, name), content)
  return at
}

function harness(options: { env?: Environment; home?: string; models?: Partial<Record<Role, string>>; instructions?: string } = {}) {
  const log = recordingLog()
  const at = folder()
  const created: Harness = createCodex({
    folder: at,
    log,
    command: fake('fake-codex.ts'),
    env: { ...process.env, CODEX_HOME: options.home ?? home(), ...options.env },
    ...(options.models ? { models: options.models } : {})
  })
  const session = (tools = false, role: Role = 'thread') => {
    const opened = created.open({
      role,
      instructions: options.instructions ?? 'You are Ada.',
      ...(tools ? { tools: { url: 'http://127.0.0.1:4000/mcp', token: 'secret-token' } } : {})
    })
    open.push(opened)
    return opened
  }
  return { harness: created, session, log, folder: at }
}

describe('a Codex session', () => {
  it('gives the reply piece by piece, in order, then the end of the turn', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('hello there')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['text:You said: h', 'text:ello there', 'turn-end'])
  })

  it('keeps what happened before anyone listened', async () => {
    const session = harness().session()
    session.send('hello')
    // Long enough, on most machines, for the whole turn to happen unheard.
    await new Promise((resolve) => setTimeout(resolve, 500))

    const followed = follow(session)
    await followed.until('turn-end')
    expect(followed.text()).toBe('You said: hello')
    expect(followed.outline().at(-1)).toBe('turn-end')
  })

  it('keeps the conversation open, turn after turn', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('one')
    await followed.until('turn-end')
    session.send('two')
    await followed.until('turn-end', 2)

    expect(followed.text()).toBe('You said: oneYou said: two')
  })

  it('takes the whole message when it does not come in pieces, once', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('whole')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['text:All at once.', 'turn-end'])
  })

  it('reports the calls to the tools of the core, and lets Codex make them', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('use a tool')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['tool:ui_render:started', 'tool:ui_render:ended', "text:The core's tool was accepted.", 'turn-end'])
  })

  it('starts a new paragraph for the text that follows a tool call', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('blocks')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Before.\n\nAfter.')
  })

  it('declines the tools of any other server, and does not report them', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('other server')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(["text:Another server's tool was declined.", 'turn-end'])
  })

  it('declines every command and file change, and answers what it does not know with an error', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('command')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Decisions: decline, decline, denied. Unknown: -32601.')
  })

  it('stops the turn under way when interrupted, and stays usable', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('slow')
    await followed.until('text')
    session.interrupt()
    await followed.until('turn-end')
    session.send('again')
    await followed.until('turn-end', 2)

    expect(followed.text()).toBe('one You said: again')
  })

  it('interrupts a turn that was only just asked for', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('slow')
    session.interrupt()
    await followed.until('turn-end')

    expect(followed.outline().at(-1)).toBe('turn-end')
  })

  it('steers the turn under way with what is said during it, and ends the turn once', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('wait for more')
    session.send('this too')
    await followed.until('turn-end')
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(followed.outline()).toEqual(['text:Both: wait for more + this too', 'turn-end'])
  })

  it('starts a new turn with what arrived as the turn ended, and still ends the turn once', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('wait for more')
    session.send('too late')
    await followed.until('turn-end')
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(followed.text()).toBe('Both: wait for more + nothing more\n\nYou said: too late')
    expect(followed.events.filter((event) => event.type === 'turn-end')).toHaveLength(1)
  })

  it('goes on when Codex says it will retry', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('retry')
    await followed.until('turn-end')

    expect(followed.text()).toBe('You said: retry')
  })

  it('fails, with the reason, when Codex stops', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('crash')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Codex stopped unexpectedly (exit code 3): warming up boom: the session broke'])
    session.send('anyone?')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(followed.events).toHaveLength(1)
  })

  it('fails with what Codex reports when a turn fails', async () => {
    const { session, log } = harness()
    const opened = session()
    const followed = follow(opened)
    opened.send('overloaded')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Codex reported an error: The model is overloaded.'])
    expect(log.errors).toHaveLength(1)
  })

  it('fails when the user is not signed in, and says so', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('signed out')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Codex is not signed in. Sign in to it, then try again.'])
  })

  it('fails when Codex refuses to open the conversation', async () => {
    const session = harness({ instructions: 'refuse the thread' }).session()
    const followed = follow(session)
    session.send('hello')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Codex is not signed in. Sign in to it, then try again.'])
  })

  it('fails when Codex cannot be started', async () => {
    const session = createCodex({ folder: folder(), log: recordingLog(), command: ['/nowhere/codex'], env: { ...process.env, CODEX_HOME: home() } }).open({
      role: 'thread',
      instructions: ''
    })
    open.push(session)
    const followed = follow(session)
    await followed.until('failed')

    expect(followed.outline()[0]).toMatch(/^failed:Codex could not be started: /)
  })

  it('fails when Codex is not installed', async () => {
    const nowhere: Cli = { launch: () => Promise.reject(new NotInstalled(NOT_INSTALLED)), find: () => Promise.resolve(undefined) }
    const session = openSession({ role: 'thread', instructions: '' }, { cli: nowhere, folder: folder(), models: {}, log: recordingLog() })
    open.push(session)
    const followed = follow(session)
    session.send('hello')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Codex is not installed. Install it from developers.openai.com/codex, then sign in.'])
  })

  it('says nothing more once closed, and stops Codex', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('pid')
    await followed.until('turn-end')
    const pid = Number(followed.text())
    const count = followed.events.length

    session.close()
    session.send('ignored')
    session.interrupt()
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 10_000
    while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))

    expect(alive()).toBe(false)
    expect(followed.events).toHaveLength(count)
  })

  it('starts Codex with everything of its own switched off, the user’s tool servers included', async () => {
    const theirs = home({
      'config.toml': 'model = "x"\n\n[mcp_servers.mail]\ncommand = "mail"\n\n[mcp_servers."my notes"]\nurl = "http://localhost:1"\n\n[other.table]\n'
    })
    const { session, folder: at } = harness({ home: theirs })
    const opened = session(true)
    const followed = follow(opened)
    opened.send('argv')
    await followed.until('turn-end')
    const args: string[] = JSON.parse(followed.text())
    const disabled = args.filter((_, index) => args[index - 1] === '--disable')
    const settings = args.filter((_, index) => args[index - 1] === '-c')

    expect(args[0]).toBe('app-server')
    expect(disabled).toEqual([
      'apps',
      'computer_use',
      'browser_use',
      'browser_use_external',
      'in_app_browser',
      'plugins',
      'image_generation',
      'multi_agent',
      'memories'
    ])
    expect(settings).toEqual(
      expect.arrayContaining(['mcp_servers.mail.enabled=false', 'mcp_servers."my notes".enabled=false', 'features.shell_tool=false', 'project_doc_max_bytes=0'])
    )
    expect(settings.includes('windows.sandbox="unelevated"')).toBe(process.platform === 'win32')
    // Nothing is written in the working folder: Codex takes its instructions in the request that opens the conversation.
    expect(readdirSync(at)).toEqual([])
  })

  it('opens the conversation with the instructions, a read-only sandbox, and the core’s tool server', async () => {
    const { session, folder: at } = harness()
    const opened = session(true)
    const followed = follow(opened)
    opened.send('thread')
    await followed.until('turn-end')

    expect(JSON.parse(followed.text())).toEqual({
      cwd: at,
      model: 'gpt-6.1-sol',
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      ephemeral: true,
      developerInstructions: 'You are Ada.',
      config: { mcp_servers: { core: { url: 'http://127.0.0.1:4000/mcp', http_headers: { Authorization: 'Bearer secret-token' }, tool_timeout_sec: 3600 } } }
    })
  })

  it('names no tool server when the session has no tools', async () => {
    const session = harness().session(false)
    const followed = follow(session)
    session.send('thread')
    await followed.until('turn-end')

    expect(JSON.parse(followed.text())).not.toHaveProperty('config')
  })

  it('creates its working folder and runs Codex in it', async () => {
    const at = join(folder(), 'not', 'there', 'yet')
    const created = createCodex({ folder: at, log: recordingLog(), command: fake('fake-codex.ts'), env: { ...process.env, CODEX_HOME: home() } })
    const session = created.open({ role: 'thread', instructions: '' })
    open.push(session)
    const followed = follow(session)
    session.send('folder')
    await followed.until('turn-end')

    expect(existsSync(at)).toBe(true)
    // The same folder can be written two ways: through a link on macOS, by a short name on Windows.
    expect(realpathSync.native(followed.text())).toBe(realpathSync.native(at))
  })

  it('runs each role on a model Codex lists for this user, or on the one chosen', async () => {
    const listed = home({
      'models_cache.json': JSON.stringify({
        models: [
          { slug: 'hidden-one', visibility: 'hide' },
          { slug: 'gpt-7-workhorse', visibility: 'list' },
          { slug: 'gpt-6-luna', visibility: 'list' }
        ]
      })
    })
    const model = async (options: Parameters<typeof harness>[0], role: Role) => {
      const session = harness(options).session(false, role)
      const followed = follow(session)
      session.send('thread')
      await followed.until('turn-end')
      return JSON.parse(followed.text()).model
    }

    expect(await model({ home: listed }, 'thread')).toBe('gpt-7-workhorse')
    expect(await model({ home: listed }, 'orchestrator')).toBe('gpt-6-luna')
    expect(await model({ home: listed }, 'utility')).toBe('gpt-6-luna')
    expect(await model({ home: listed, models: { utility: 'gpt-7-workhorse' } }, 'utility')).toBe('gpt-7-workhorse')
    // Without Codex's own list, the one built in. Without the fast model in the list, the workhorse everywhere.
    expect(await model({}, 'orchestrator')).toBe('gpt-6-luna')
    expect(await model({ home: home({ 'models_cache.json': '{"models":[{"slug":"only-one","visibility":"list"}]}' }) }, 'orchestrator')).toBe('only-one')
  })
})
