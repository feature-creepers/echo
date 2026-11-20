import { type CoreMessage, encodeLine, onPortMessage, type Ready, starterMessageSchema } from '@repo/protocol'
import { type Composition, compose } from './compose.ts'
import { type Config, ConfigError, firstLine, readConfig, USAGE } from './config.ts'
import { listenLocal } from './listeners/local/index.ts'

/**
 * The core as a process.
 *
 * Standard output carries one line, the announcement of where the core listens. Everything else goes to standard error.
 * Exit code 2 means it was started wrongly; 1 means it could not open the user's data.
 */

/**
 * What Electron adds to `process` in a utility process: the port to the app that started it, whose listener is handed
 * the message in `data`. Described here, since the core does not depend on Electron.
 */
interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  postMessage(message: CoreMessage): void
}
const port = (process as { parentPort?: ParentPort }).parentPort

/** Told the token the app gives on the port, once asked for it. */
let tokenGiven: (token: string) => void = () => undefined
// What the app says on the port, by type: listened to before the core asks it anything, so no answer comes first.
const fromApp = onPortMessage(starterMessageSchema, {
  // A promise settles once: the first token stands, and a later one changes nothing.
  token: ({ token }) => tokenGiven(token)
})
port?.on('message', ({ data }) => fromApp(data))

// The token comes first, from the program that started the core: asked for on the port when Electron runs it, else
// the first line of standard input. Never the environment, which the person's other programs can read.
const token = port
  ? new Promise<string>((resolve) => {
      tokenGiven = resolve
      port.postMessage({ type: 'token-wanted' })
    })
  : firstLine(process.stdin)

let config: Config
try {
  config = await readConfig(process.argv.slice(2), token)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  process.stderr.write(`${error.message}\n\n${USAGE}\n`)
  process.exit(2)
}

let composition: Composition
try {
  composition = await compose(config)
} catch (error) {
  process.stderr.write(`The core could not open the user's data in "${config.data}": ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const listener = await listenLocal(composition.core)

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await listener.close()
  await composition.close()
  process.exit(0)
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
if (config.exitWithParent) {
  // The app that started the core holds the other end of standard input. When it goes, for any reason, this ends:
  // it may have gone already, right after the token.
  if (process.stdin.readableEnded) void stop()
  process.stdin.on('end', () => void stop())
  process.stdin.on('close', () => void stop())
  process.stdin.resume()
}

const ready: Ready = { type: 'ready', endpoint: listener.address }
process.stdout.write(encodeLine(ready))
