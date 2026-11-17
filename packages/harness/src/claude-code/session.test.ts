import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness, Session } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { eventually, fake, folder, follow, recordingLog, removeFolders } from '../../test/sessions.ts'
import { type Cli, NotInstalled } from '../process/cli.ts'
import type { Environment } from '../process/environment.ts'
import { createClaudeCode } from './adapter.ts'
import { openSession } from './session.ts'
import { NOT_INSTALLED } from './status.ts'

const open: Session[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.close()
  removeFolders()
})

function harness(options: { env?: Environment; folder?: string } = {}) {
  const log = recordingLog()
  const at = options.folder ?? folder()
  const created: Harness = createClaudeCode({ folder: at, log, command: fake('fake-claude.ts'), env: options.env ?? process.env })
  const session = (tools = false) => {
    const opened = created.open({
      role: 'orchestrator',
      instructions: 'You are Ada.',
      ...(tools ? { tools: { url: 'http://127.0.0.1:4000/mcp', token: 'secret-token' } } : {})
    })
    open.push(opened)
    return opened
  }
  return { harness: created, session, log, folder: at }
}

describe('a Claude Code session', () => {
  it('gives the reply piece by piece, in order, then the end of the turn', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('hello there')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['text:You sai', 'text:d: hell', 'text:o there', 'turn-end'])
    expect(followed.text()).toBe('You said: hello there')
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

  it('takes the whole reply when it does not come in pieces, once', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('whole')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['text:All at once.', 'turn-end'])
  })

  it('reports the calls to the tools of the core by the names the core gave them', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('use a tool')
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['tool:ui_render:started', 'tool:ui_render:ended', 'text:After', 'text:.', 'turn-end'])
  })

  it('starts a new paragraph for the text that follows a tool call', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('blocks')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Before.\n\nAfter.')
  })

  it('refuses any tool that is not the core’s', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('foreign')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Refused: This tool is not available in this session.')
    expect(followed.events.some((event) => event.type === 'tool')).toBe(false)
  })

  it('answers a question it does not know with an error, so the CLI is not left waiting', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('strange question')
    await followed.until('turn-end')

    expect(followed.text()).toBe('Answered with error.')
  })

  it('leaves out what a sub-agent says', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('sub-agent')
    await followed.until('turn-end')

    expect(followed.text()).toBe('You said: sub-agent')
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

    expect(followed.outline()).toEqual(['text:one ', 'turn-end', 'text:You s', 'text:aid: ', 'text:again', 'turn-end'])
  })

  it('ends a tool call that an interruption cut short', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('unfinished')
    await followed.until('tool')
    session.interrupt()
    await followed.until('turn-end')

    expect(followed.outline()).toEqual(['tool:ui_render:started', 'tool:ui_render:ended', 'turn-end'])
  })

  it('ends the turn once, when what was said during it was taken into it', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('absorb this')
    session.send('and that')
    await followed.until('turn-end')
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(followed.outline()).toEqual(['text:Both: absorb this + and that', 'turn-end'])
  })

  it('ends the turn once, when what was said during it is answered after it', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('first')
    session.send('second')
    await followed.until('turn-end')
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(followed.text()).toBe('You said: first\n\nYou said: second')
    expect(followed.events.filter((event) => event.type === 'turn-end')).toHaveLength(1)
  })

  it('ends the turn at each result of a CLI that does not say which message it answered', async () => {
    const session = harness({ env: { ...process.env, FAKE_OLD: '1' } }).session()
    const followed = follow(session)
    session.send('first')
    await followed.until('turn-end')
    session.send('second')
    await followed.until('turn-end', 2)

    expect(followed.text()).toBe('You said: firstYou said: second')
  })

  it('fails, with the reason, when the CLI stops', async () => {
    const { session, folder: at } = harness()
    const opened = session()
    const followed = follow(opened)
    opened.send('crash')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Claude Code stopped unexpectedly (exit code 3): warming up boom: the session broke'])
    // A failed session is closed: sending does nothing, and its files are gone.
    opened.send('anyone?')
    await eventually(() => readdirSync(at).length === 0)
    expect(followed.events).toHaveLength(1)
  })

  it('fails when the user is not signed in, and says so', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('signed out')
    await followed.until('failed')

    // What the CLI wrote as a reply is its own notice, not something to say.
    expect(followed.outline()).toEqual(['failed:Claude Code is not signed in. Sign in to it, then try again.'])
  })

  it('fails with what the CLI reports when a turn ends in error', async () => {
    const { session, log } = harness()
    const opened = session()
    const followed = follow(opened)
    opened.send('limit')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Claude Code reported an error: You have hit your usage limit · it resets at 3pm'])
    expect(log.errors).toHaveLength(1)
  })

  it('fails when the CLI cannot be started', async () => {
    const log = recordingLog()
    const session = createClaudeCode({ folder: folder(), log, command: ['/nowhere/claude'], env: process.env }).open({ role: 'thread', instructions: '' })
    open.push(session)
    const followed = follow(session)
    await followed.until('failed')

    expect(followed.outline()[0]).toMatch(/^failed:Claude Code could not be started: /)
  })

  it('fails when the CLI is not installed', async () => {
    const nowhere: Cli = { launch: () => Promise.reject(new NotInstalled(NOT_INSTALLED)), find: () => Promise.resolve(undefined) }
    const session = openSession({ role: 'thread', instructions: '' }, { cli: nowhere, folder: folder(), model: 'haiku', log: recordingLog() })
    open.push(session)
    const followed = follow(session)
    session.send('hello')
    await followed.until('failed')

    expect(followed.outline()).toEqual(['failed:Claude Code is not installed. Install it from claude.com/claude-code, then sign in.'])
  })

  it('says nothing more once closed, and removes its files', async () => {
    const { session, folder: at } = harness()
    const opened = session(true)
    const followed = follow(opened)
    opened.send('slow')
    await followed.until('text')
    const written = readdirSync(at).map((name) => name.split('.').slice(1).join('.'))
    expect(written.sort()).toEqual(['instructions.txt', 'settings.json', 'tools.json'])

    opened.close()
    opened.send('ignored')
    opened.interrupt()
    await eventually(() => readdirSync(at).length === 0)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(followed.outline()).toEqual(['text:one '])
  })

  it('stops a CLI that does not stop by itself when closed', async () => {
    const session = harness().session()
    const followed = follow(session)
    session.send('stubborn pid')
    await followed.until('turn-end')
    const pid = Number(followed.text())
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    expect(alive()).toBe(true)

    session.close()
    const deadline = Date.now() + 10_000
    while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    expect(alive()).toBe(false)
  })

  it('creates its working folder and runs the CLI in it', async () => {
    const at = join(folder(), 'not', 'there', 'yet')
    const session = harness({ folder: at }).session()
    const followed = follow(session)
    session.send('folder')
    await followed.until('turn-end')

    expect(existsSync(at)).toBe(true)
    // The same folder can be written two ways: through a link on macOS, by a short name on Windows.
    expect(realpathSync.native(followed.text())).toBe(realpathSync.native(at))
  })

  it('starts the CLI with everything of its own switched off', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('argv')
    await followed.until('turn-end')
    const args: string[] = JSON.parse(followed.text())
    const value = (flag: string) => args[args.indexOf(flag) + 1]

    expect(args.slice(0, 9)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio'
    ])
    expect(value('--model')).toBe('haiku')
    expect(value('--tools')).toBe('')
    expect(value('--setting-sources')).toBe('')
    expect(value('--system-prompt-file')).toMatch(/instructions\.txt$/)
    expect(value('--settings')).toMatch(/settings\.json$/)
    expect(value('--mcp-config')).toMatch(/tools\.json$/)
    for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) expect(args).toContain(flag)
  })

  it('hands the CLI its instructions whole, its settings and the address of the tool server', async () => {
    const session = harness().session(true)
    const followed = follow(session)
    session.send('files')
    await followed.until('turn-end')
    const files = JSON.parse(followed.text())

    expect(files.instructions).toBe('You are Ada.')
    expect(JSON.parse(files.settings)).toEqual({ autoMemoryEnabled: false })
    expect(JSON.parse(files.tools)).toEqual({
      mcpServers: { core: { type: 'http', url: 'http://127.0.0.1:4000/mcp', headers: { Authorization: 'Bearer secret-token' } } }
    })
  })

  it('names no tool server when the session has no tools', async () => {
    const session = harness().session(false)
    const followed = follow(session)
    session.send('argv')
    await followed.until('turn-end')

    expect(JSON.parse(followed.text())).not.toContain('--mcp-config')
  })

  it('runs each role on its model, or on the one chosen', async () => {
    const at = folder()
    const chosen = createClaudeCode({ folder: at, log: recordingLog(), command: fake('fake-claude.ts'), env: process.env, models: { thread: 'opus' } })
    const models: string[] = []
    for (const role of ['orchestrator', 'thread', 'utility'] as const) {
      const session = chosen.open({ role, instructions: '' })
      open.push(session)
      const followed = follow(session)
      session.send('argv')
      await followed.until('turn-end')
      const args: string[] = JSON.parse(followed.text())
      models.push(args[args.indexOf('--model') + 1] ?? '')
    }

    expect(models).toEqual(['haiku', 'opus', 'haiku'])
  })

  it('runs on the model a session asks for, in place of its role’s', async () => {
    const session = harness().harness.open({ role: 'thread', instructions: '', model: 'sonnet' })
    open.push(session)
    const followed = follow(session)
    session.send('argv')
    await followed.until('turn-end')
    const args: string[] = JSON.parse(followed.text())
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')
  })

  it('starts the CLI without the marks of a surrounding agent session, and with its memory off', async () => {
    const session = harness({
      env: {
        ...process.env,
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SESSION_ID: 'outer',
        CLAUDE_AGENT_SDK_VERSION: '1',
        AI_AGENT: 'outer',
        CLAUDE_CONFIG_DIR: '/somewhere/else',
        UNRELATED: 'kept'
      }
    }).session()
    const followed = follow(session)
    session.send('environment')
    await followed.until('turn-end')
    const env = JSON.parse(followed.text())

    for (const name of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_AGENT_SDK_VERSION', 'AI_AGENT'])
      expect(env).not.toHaveProperty(name)
    expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: '/somewhere/else', UNRELATED: 'kept', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', MCP_TOOL_TIMEOUT: '3600000' })
  })

  it('reports a CLI that starts with more than it was given', async () => {
    const { session, log } = harness({ env: { ...process.env, FAKE_LEAK: '1' } })
    const opened = session(true)
    const followed = follow(opened)
    opened.send('hello')
    await followed.until('turn-end')
    opened.send('hello again')
    await followed.until('turn-end', 2)

    expect(log.errors).toEqual(['A Claude Code session started with its own tools (Bash), its own memory, which should all be switched off.'])
  })

  it('reports a tool server it could not reach', async () => {
    const { session, log } = harness({ env: { ...process.env, FAKE_TOOL_SERVER_STATUS: 'failed' } })
    const opened = session(true)
    const followed = follow(opened)
    opened.send('hello')
    await followed.until('turn-end')

    expect(log.errors).toEqual(['A Claude Code session could not connect to the tool server at http://127.0.0.1:4000/mcp: it has no tools.'])
  })
})
