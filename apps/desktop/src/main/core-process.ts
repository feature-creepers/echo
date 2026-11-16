import { randomBytes } from 'node:crypto'
import { ConnectionRefused, connect, type Connection, type CoreLink, type Identity } from '@repo/client'
import { openLocal } from '@repo/client/transports/local'
import { CORE_TOKEN_VARIABLE, createLineDecoder, readySchema } from '@repo/protocol'
import { utilityProcess } from 'electron'

/** How long the core has to announce where it listens. */
const READY_TIMEOUT_MS = 15_000

/** How long the app waits for the core to stop before it quits anyway. */
const STOP_TIMEOUT_MS = 3_000

export interface CoreProcessOptions {
  /** The core's program, built beside the app's main process. */
  script: string
  client: Identity['client']
  capabilities: Identity['capabilities']
}

export interface CoreProcess {
  /** Where the app stands with its core, now. */
  link(): CoreLink
  /** Sets the one listener told each time that changes. */
  onLink(listener: (link: CoreLink) => void): void
  /** Resolves when the link is settled: connected or failed. */
  settled(): Promise<CoreLink>
  /**
   * Ask the core to stop and wait until it has, so it can remove what it created on disk.
   * The app must wait for this before it quits: a core still running when the app exits is cut off mid-cleanup.
   */
  stop(): Promise<void>
}

/**
 * Start the core as a process of its own and connect to it the way any client does: over its local
 * endpoint, with the protocol. The app holds no shortcut into the core.
 *
 * The core runs as an Electron utility process, which ends with the app, so it is not asked to watch
 * its standard input. The token is made for this launch and is known only to the two of them.
 */
export function startCore(options: CoreProcessOptions): CoreProcess {
  const token = randomBytes(32).toString('hex')
  let link: CoreLink = { state: 'starting' }
  let listener: ((link: CoreLink) => void) | undefined
  let connection: Connection | undefined
  let stopped = false
  let exited = false
  let stopping: Promise<void> | undefined
  let whenSettled: (link: CoreLink) => void = () => undefined
  const settled = new Promise<CoreLink>((resolve) => (whenSettled = resolve))

  const set = (next: CoreLink) => {
    if (stopped) return
    link = next
    listener?.(link)
    if (next.state !== 'starting') whenSettled(next)
  }
  const fail = (reason: string) => {
    // The first failure is the cause. What follows it, such as the process ending, is a consequence.
    if (link.state !== 'failed') set({ state: 'failed', reason })
  }

  const child = utilityProcess.fork(options.script, [], {
    serviceName: 'Core',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, [CORE_TOKEN_VARIABLE]: token }
  })

  let errors = ''
  child.stderr?.setEncoding('utf8').on('data', (text: string) => {
    errors = (errors + text).slice(-2000)
    process.stderr.write(text)
  })

  const late = setTimeout(() => fail('the core did not say where it listens.'), READY_TIMEOUT_MS)
  const decoder = createLineDecoder()
  let announced = false
  child.stdout?.setEncoding('utf8').on('data', (text: string) => {
    for (const line of decoder.push(text)) {
      if (announced || !line.ok) continue
      const ready = readySchema.safeParse(line.message)
      if (!ready.success) continue
      announced = true
      clearTimeout(late)
      void join(ready.data.endpoint)
    }
  })

  child.once('exit', (code) => {
    exited = true
    clearTimeout(late)
    const detail = errors.trim().split('\n').slice(-3).join(' ')
    fail(`the core stopped (exit code ${code})${detail ? `: ${detail}` : '.'}`)
  })

  async function join(endpoint: string): Promise<void> {
    try {
      connection = await connect(await openLocal(endpoint), { client: options.client, capabilities: options.capabilities, credential: token })
      connection.onClose(() => fail('the link to the core closed.'))
      set({ state: 'connected', core: connection.core })
    } catch (error) {
      if (error instanceof ConnectionRefused && error.reason === 'protocol') {
        fail('the app and its core were built for different versions of their protocol.')
      } else {
        fail(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return {
    link: () => link,
    onLink: (next) => {
      listener = next
    },
    settled: () => settled,
    stop: () => {
      stopping ??= new Promise<void>((resolve) => {
        stopped = true
        clearTimeout(late)
        connection?.close()
        if (exited) return resolve()
        const giveUp = setTimeout(resolve, STOP_TIMEOUT_MS)
        child.once('exit', () => {
          clearTimeout(giveUp)
          resolve()
        })
        // A termination signal on macOS and Linux, which the core answers by cleaning up and exiting.
        // Windows ends the process at once, and the core leaves nothing on disk there.
        child.kill()
      })
      return stopping
    }
  }
}
