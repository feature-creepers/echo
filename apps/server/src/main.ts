import { CORE_TOKEN_VARIABLE, encodeLine, type Ready } from '@repo/protocol'
import { type Composition, compose } from './compose.ts'
import { type Config, ConfigError, readConfig, USAGE } from './config.ts'
import { listenLocal } from './listeners/local/index.ts'

/**
 * The core as a process.
 *
 * Standard output carries one line, the announcement of where the core listens. Everything else goes to standard error.
 * Exit code 2 means it was started wrongly; 1 means it could not open the user's data.
 */

let config: Config
try {
  config = readConfig(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  process.stderr.write(`${error.message}\n\n${USAGE}\n`)
  process.exit(2)
}
// Every program the core starts (the AI program, the commands it runs) inherits this environment: the token, which
// admits a client as the person's own app, must not reach them.
delete process.env[CORE_TOKEN_VARIABLE]

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
  // The app that started the core holds the other end of standard input. When it goes, for any reason, this ends.
  process.stdin.on('end', () => void stop())
  process.stdin.on('close', () => void stop())
  process.stdin.resume()
}

const ready: Ready = { type: 'ready', endpoint: listener.address }
process.stdout.write(encodeLine(ready))
