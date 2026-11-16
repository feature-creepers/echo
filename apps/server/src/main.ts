import { encodeLine, type Ready } from '@repo/protocol'
import { compose } from './compose.ts'
import { ConfigError, USAGE, readConfig, type Config } from './config.ts'
import { listenLocal } from './listeners/local/index.ts'

/**
 * The core as a process.
 *
 * Standard output carries one line, the announcement of where the core listens. Everything else goes to standard error.
 */

let config: Config
try {
  config = readConfig(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  process.stderr.write(`${error.message}\n\n${USAGE}\n`)
  process.exit(2)
}

const core = compose(config)
const listener = await listenLocal(core, { address: config.listen })

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await listener.close()
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
