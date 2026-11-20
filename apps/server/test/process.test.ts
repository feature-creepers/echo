import { type ChildProcess, fork, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMMANDS,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  createLineDecoder,
  DATA_OPTION,
  EXIT_WITH_PARENT_FLAG,
  encodeLine,
  type Hello,
  PROTOCOL_VERSION,
  readySchema,
  resultSchema,
  type StarterMessage
} from '@repo/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

/**
 * These tests start the core as the separate program it is, from its sources, and talk to it over
 * the local endpoint with nothing but the protocol: the way any client has to.
 */

const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url))
/** Electron's port to the app, played by Node's channel to a parent that forked the core. */
const PORT = new URL('./electron-port.ts', import.meta.url).href
const TOKEN = 'the-right-token'
/** How long to wait, after the last answer, for the core to hang up. */
const CLOSE_GRACE_MS = 1000

const hello: Hello = {
  type: 'hello',
  protocol: PROTOCOL_VERSION,
  client: { kind: 'desktop', version: '0.1.0', device: 'device-1' },
  capabilities: ['display'],
  credential: TOKEN
}

const running = new Set<{ child: ChildProcess; exited: Promise<unknown> }>()
const folders: string[] = []
const sockets = new Set<Socket>()

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  for (const { child } of running) child.kill()
  await Promise.all([...running].map(({ exited }) => exited))
  running.clear()
  // On Windows a folder can stay locked for a moment after the process that used it is gone.
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** A fresh folder for a user's data, removed after the test. */
function dataFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'core-test-'))
  folders.push(folder)
  return folder
}

interface StartOptions {
  /** The folder for the user's data. Left out, a fresh one. `null` starts the core without the option. */
  data?: string | null
  args?: string[]
  /** The first line written on its standard input. `null` writes none, and closes it. */
  token?: string | null
}

/** Start the core as Node runs it, its token on the first line of its standard input. */
function start({ data = dataFolder(), args = [EXIT_WITH_PARENT_FLAG], token = TOKEN }: StartOptions = {}) {
  const all = data === null ? args : [`--${DATA_OPTION}`, data, ...args]
  const child = spawn(process.execPath, [ENTRY, ...all], { stdio: ['pipe', 'pipe', 'pipe'] })
  if (token === null) child.stdin.end()
  else child.stdin.write(`${token}\n`)
  // Ask the core to stop the way its starter does.
  return watch(child, () => child.stdin.end())
}

/** Start the core as the desktop app does: it asks for its token on the port, and is given `answers` then. */
function startByApp(answers: StarterMessage[]) {
  const child = fork(ENTRY, [`--${DATA_OPTION}`, dataFolder()], { execArgv: ['--import', PORT], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const asked: unknown[] = []
  child.on('message', (message) => {
    asked.push(message)
    for (const answer of answers) child.send(answer)
  })
  return { ...watch(child, () => child.kill()), asked }
}

/** What a core started as a child says: where it listens, how it ended, what it wrote on its standard error. */
function watch(child: ChildProcess, ending: () => void) {
  let stderr = ''
  child.stderr?.setEncoding('utf8').on('data', (text: string) => (stderr += text))
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  running.add({ child, exited })
  /** The endpoint the core announces on its standard output. */
  const endpoint = new Promise<string>((resolve, reject) => {
    const decoder = createLineDecoder()
    child.stdout?.setEncoding('utf8').on('data', (text: string) => {
      for (const line of decoder.push(text)) if (line.ok) resolve(readySchema.parse(line.message).endpoint)
    })
    void exited.then((code) => reject(new Error(`The core exited with code ${code} before it was ready: ${stderr}`)))
  })
  // A test that expects the core to refuse to start never waits for the endpoint: that rejection is then expected.
  endpoint.catch(() => undefined)
  /** Ask the core to stop, and wait until it has. */
  const stop = () => {
    ending()
    return exited
  }
  return { child, endpoint, exited, stop, stderr: () => stderr }
}

/** Open the endpoint, send what `say` holds, and collect what the core answers until it hangs up or `until` messages arrived. */
function exchange(endpoint: string, say: string, until = 1): Promise<{ replies: unknown[]; closedByCore: boolean; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    sockets.add(socket)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()
    const replies: unknown[] = []
    socket.once('connect', () => socket.write(say))
    socket.on('error', reject)
    socket.on('data', (text: string) => {
      for (const line of decoder.push(text)) replies.push(line.ok ? line.message : line)
      // A core that hangs up does so right after its answer, but a Windows pipe can take a few hundred
      // milliseconds to say it closed while every package's tests run at once, so the wait is generous.
      if (replies.length >= until) setTimeout(() => resolve({ replies, closedByCore: socket.destroyed, socket }), CLOSE_GRACE_MS)
    })
    socket.on('close', () => resolve({ replies, closedByCore: true, socket }))
  })
}

/** Connect and say hello. Gives what an admitted client can do: run a command, and wait for the next event. */
async function joinCore(endpoint: string) {
  const socket = connect(endpoint)
  sockets.add(socket)
  socket.setEncoding('utf8')
  const decoder = createLineDecoder()
  const received: unknown[] = []
  const waiting: ((message: unknown) => void)[] = []
  socket.on('data', (text: string) => {
    for (const line of decoder.push(text)) {
      const message = line.ok ? line.message : line
      const next = waiting.shift()
      if (next) next(message)
      else received.push(message)
    }
  })
  const next = () => new Promise<unknown>((resolve) => (received.length ? resolve(received.shift()) : waiting.push(resolve)))

  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject))
  socket.write(encodeLine(hello))
  expect(await next()).toMatchObject({ type: 'welcome' })

  let commands = 0
  /** Send a command and return its output. Events that arrive first are skipped. */
  async function run<Name extends CommandName>(name: Name, input: CommandInput<Name>): Promise<CommandOutput<Name>> {
    const id = `c${++commands}`
    socket.write(encodeLine({ type: 'command', id, name, input }))
    for (;;) {
      const result = resultSchema.safeParse(await next())
      if (!result.success || result.data.id !== id) continue
      if (!result.data.ok) throw new Error(`"${name}" was refused: ${result.data.error.code}`)
      return COMMANDS[name].output.parse(result.data.output) as CommandOutput<Name>
    }
  }
  return { run, next, socket }
}

describe('the core as a process', () => {
  it('announces where it listens and welcomes a client that presents the token', async () => {
    const core = start()
    const { replies, closedByCore, socket } = await exchange(await core.endpoint, encodeLine(hello))
    expect(replies).toEqual([{ type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: manifest.version } }])
    expect(closedByCore).toBe(false)
    socket.destroy()
  })

  it('refuses a wrong token and hangs up', async () => {
    const core = start()
    const { replies, closedByCore } = await exchange(await core.endpoint, encodeLine({ ...hello, credential: 'a-guess' }))
    expect(replies).toEqual([{ type: 'refusal', reason: 'credential', protocol: PROTOCOL_VERSION }])
    expect(closedByCore).toBe(true)
  })

  it('refuses a client from another protocol version by name', async () => {
    const core = start()
    const { replies } = await exchange(await core.endpoint, encodeLine({ type: 'hello', protocol: PROTOCOL_VERSION + 1 }))
    expect(replies).toEqual([{ type: 'refusal', reason: 'protocol', protocol: PROTOCOL_VERSION }])
  })

  it('refuses a first line that is not a message', async () => {
    const core = start()
    const { replies, closedByCore } = await exchange(await core.endpoint, 'GET / HTTP/1.1\n')
    expect(replies).toEqual([{ type: 'refusal', reason: 'malformed', protocol: PROTOCOL_VERSION }])
    expect(closedByCore).toBe(true)
  })

  it('serves several clients at once', async () => {
    const core = start()
    const endpoint = await core.endpoint
    const results = await Promise.all([exchange(endpoint, encodeLine(hello)), exchange(endpoint, encodeLine(hello)), exchange(endpoint, encodeLine(hello))])
    for (const { replies, socket } of results) {
      expect(replies).toMatchObject([{ type: 'welcome' }])
      socket.destroy()
    }
  })

  it('stops, and removes its endpoint, when the program that started it goes away', async () => {
    const core = start()
    const endpoint = await core.endpoint
    expect(await core.stop()).toBe(0)
    // A named pipe on Windows is not a file; on the other systems the socket and its folder must be gone.
    if (process.platform !== 'win32') expect(existsSync(endpoint)).toBe(false)
    await expect(exchange(endpoint, encodeLine(hello))).rejects.toThrow()
  })

  it.each([
    { case: 'no token, its standard input closed', token: null, says: 'No token was given.' },
    { case: 'an empty line', token: '', says: 'The token given is empty.' }
  ])('refuses to start with $case, and says how to give one', async ({ token, says }) => {
    const core = start({ token })
    expect(await core.exited).toBe(2)
    expect(core.stderr()).toContain(says)
    expect(core.stderr()).toContain('first line of standard input')
  })

  it('stops when its standard input closes right after the token', async () => {
    const core = start()
    core.child.stdin?.end()
    expect(await core.exited).toBe(0)
  })

  it.runIf(process.platform === 'linux')('keeps its token out of the environment the system shows of it', async () => {
    const core = start()
    await core.endpoint
    expect(readFileSync(`/proc/${core.child.pid}/environ`, 'utf8')).not.toContain(TOKEN)
  })

  it('asks the app for its token on the port, and keeps the first one given', async () => {
    const core = startByApp([
      { type: 'token', token: TOKEN },
      { type: 'token', token: 'a-later-one' }
    ])
    const endpoint = await core.endpoint
    expect(core.asked).toEqual([{ type: 'token-wanted' }])
    const admitted = await exchange(endpoint, encodeLine(hello))
    expect(admitted.replies).toMatchObject([{ type: 'welcome' }])
    admitted.socket.destroy()
    const { replies } = await exchange(endpoint, encodeLine({ ...hello, credential: 'a-later-one' }))
    expect(replies).toEqual([{ type: 'refusal', reason: 'credential', protocol: PROTOCOL_VERSION }])
  })

  it("refuses to start without a folder for the user's data, and says why", async () => {
    const core = start({ data: null })
    expect(await core.exited).toBe(2)
    expect(core.stderr()).toContain(`--${DATA_OPTION}`)
    expect(core.stderr()).toContain('Usage:')
  })

  it('refuses an option it does not know', async () => {
    const core = start({ args: ['--nonsense'] })
    expect(await core.exited).toBe(2)
    expect(core.stderr()).toContain('Usage:')
  })
})

describe("the user's settings, through the process", () => {
  it('starts a new user with personas to confirm', async () => {
    const client = await joinCore(await start().endpoint)

    const { settings } = await client.run('settings.read', {})

    expect(settings.revision).toBe(0)
    expect(settings.personas.confirmed).toBe(false)
    expect(settings.personas.available.length).toBeGreaterThanOrEqual(2)
    expect(settings.personas.active).toBe(settings.personas.available[0]?.id)
  })

  it('tells every connected client when one of them names the personas', async () => {
    const endpoint = await start().endpoint
    const [one, other] = await Promise.all([joinCore(endpoint), joinCore(endpoint)])
    const before = (await one.run('settings.read', {})).settings
    const renamed = before.personas.available[1]
    if (!renamed) throw new Error('This test needs two personas.')

    const { settings } = await one.run('personas.set', { names: [{ persona: renamed.id, name: 'Marvin' }], active: renamed.id })

    expect(settings.personas).toMatchObject({ active: renamed.id, confirmed: true })
    expect(await other.next()).toEqual({ type: 'event', name: 'settings.changed', settings })
  })

  it('answers a command it refuses, and keeps the client', async () => {
    const client = await joinCore(await start().endpoint)
    const { settings } = await client.run('settings.read', {})
    const [first, second] = settings.personas.available
    if (!first || !second) throw new Error('This test needs two personas.')

    await expect(client.run('personas.set', { names: [{ persona: first.id, name: second.name }], active: first.id })).rejects.toThrow('name-taken')

    expect((await client.run('settings.read', {})).settings).toEqual(settings)
  })

  it('keeps what the user chose from one run to the next', async () => {
    const data = dataFolder()
    const first = start({ data })
    const before = await joinCore(await first.endpoint)
    const { settings: asked } = await before.run('settings.read', {})
    const { settings: left } = await before.run('personas.set', {
      names: asked.personas.available.map((persona, index) => ({ persona: persona.id, name: `Name ${index + 1}` })),
      active: asked.personas.available.at(-1)?.id ?? ''
    })
    expect(await first.stop()).toBe(0)

    const after = await joinCore(await start({ data }).endpoint)

    expect((await after.run('settings.read', {})).settings).toEqual(left)
  })

  it('says why it cannot start when the data was written by a more recent version', async () => {
    const data = dataFolder()
    expect(await start({ data }).stop()).toBe(0)
    const { DatabaseSync } = await import('node:sqlite')
    const file = new DatabaseSync(join(data, 'store.sqlite'))
    file.exec('pragma user_version = 999')
    file.close()

    const core = start({ data })

    expect(await core.exited).toBe(1)
    expect(core.stderr()).toContain('more recent version')
  })
})
