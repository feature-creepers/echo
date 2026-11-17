import { parseArgs } from 'node:util'
import { parentPort as threadParentPort } from 'node:worker_threads'
import { TIERS, type Tier } from '@repo/models'
import type { DuplexPort } from './port.ts'
import { serveSpeech } from './server.ts'

/**
 * The speech service as a program: it serves the engines of this machine to whatever started it, over
 * the port that goes with being started that way. It runs as an Electron utility process or as a worker
 * thread, and nowhere else.
 *
 *   --models <folder>   Where model sets are installed, and downloaded to.
 *   --tier <tier>       The hardware tier to work for: light, standard or performance.
 *                       Left out, the one detected for this machine.
 */

/**
 * What Electron adds to `process` inside a utility process. Described here because this package does not
 * depend on Electron: it runs on a server too.
 */
interface UtilityProcess {
  parentPort?: DuplexPort
}

const port: DuplexPort | null = (process as UtilityProcess).parentPort ?? threadParentPort

function fail(reason: string): never {
  process.stderr.write(`The speech service cannot start: ${reason}\n`)
  process.exit(2)
}

if (!port) fail('it must be started as an Electron utility process or as a worker thread.')

const { models, tier } = (() => {
  try {
    return parseArgs({ args: process.argv.slice(2), options: { models: { type: 'string' }, tier: { type: 'string' } }, strict: true, allowPositionals: false })
      .values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
})()

if (!models) fail('the --models option is missing: it needs the folder where models are kept.')
if (tier !== undefined && !TIERS.includes(tier as Tier)) fail(`"${tier}" is not a hardware tier. The tiers are: ${TIERS.join(', ')}.`)

serveSpeech(port, { folder: models, ...(tier !== undefined && { tier: tier as Tier }) })
