import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import { CORE_TOKEN_VARIABLE, EXIT_WITH_PARENT_FLAG, PROTOCOL_VERSION, createLineDecoder, encodeLine, readySchema, type Hello } from '@repo/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

/**
 * These tests start the core as the separate program it is, from its sources, and talk to it over
 * the local endpoint with nothing but the protocol: the way any client has to.
 */

const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const TOKEN = 'the-right-token'

const hello: Hello = {
  type: 'hello',
  protocol: PROTOCOL_VERSION,
  client: { kind: 'desktop', version: '0.1.0', device: 'device-1' },
  capabilities: ['display'],
  credential: TOKEN
}

const running = new Set<ChildProcess>()
afterEach(() => {
  for (const child of running) child.kill()
  running.clear()
})

function start(args: string[] = [EXIT_WITH_PARENT_FLAG], env: Record<string, string> = { [CORE_TOKEN_VARIABLE]: TOKEN }) {
  const child = spawn(process.execPath, [ENTRY, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  running.add(child)
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  /** The endpoint the core announces on its standard output. */
  const endpoint = new Promise<string>((resolve, reject) => {
    const decoder = createLineDecoder()
    child.stdout.setEncoding('utf8').on('data', (text: string) => {
      for (const line of decoder.push(text)) if (line.ok) resolve(readySchema.parse(line.message).endpoint)
    })
    void exited.then((code) => reject(new Error(`The core exited with code ${code} before it was ready: ${stderr}`)))
  })
  // A test that expects the core to refuse to start never waits for the endpoint: that rejection is then expected.
  endpoint.catch(() => undefined)
  return { child, endpoint, exited, stderr: () => stderr }
}

/** Open the endpoint, send what `say` holds, and collect what the core answers until it hangs up or `until` messages arrived. */
function exchange(endpoint: string, say: string, until = 1): Promise<{ replies: unknown[]; closedByCore: boolean; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()
    const replies: unknown[] = []
    socket.once('connect', () => socket.write(say))
    socket.on('error', reject)
    socket.on('data', (text: string) => {
      for (const line of decoder.push(text)) replies.push(line.ok ? line.message : line)
      if (replies.length >= until) setTimeout(() => resolve({ replies, closedByCore: socket.destroyed, socket }), 100)
    })
    socket.on('close', () => resolve({ replies, closedByCore: true, socket }))
  })
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
    core.child.stdin.end()
    expect(await core.exited).toBe(0)
    // A named pipe on Windows is not a file; on the other systems the socket and its folder must be gone.
    if (process.platform !== 'win32') expect(existsSync(endpoint)).toBe(false)
    await expect(exchange(endpoint, encodeLine(hello))).rejects.toThrow()
  })

  it('refuses to start without a token, and says why', async () => {
    const core = start([], { [CORE_TOKEN_VARIABLE]: '' })
    expect(await core.exited).toBe(2)
    expect(core.stderr()).toContain(CORE_TOKEN_VARIABLE)
    expect(core.stderr()).toContain('Usage:')
  })

  it('refuses an option it does not know', async () => {
    const core = start(['--nonsense'])
    expect(await core.exited).toBe(2)
    expect(core.stderr()).toContain('Usage:')
  })
})
