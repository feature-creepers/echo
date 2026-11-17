import { randomUUID } from 'node:crypto'
import { type Core, createCore } from '@repo/core'
import { openStore } from '@repo/store'
import manifest from '../package.json' with { type: 'json' }
import { localToken } from './auth/local-token.ts'
import type { Config } from './config.ts'

export interface Composition {
  core: Core
  /** Let go of what the core holds on this machine. Called once, when the process stops. */
  close(): void
}

/**
 * Wire the core to what it needs on this machine.
 *
 * This is the only file that knows both the core and the adapters it runs on.
 */
export function compose(config: Config): Composition {
  const store = openStore({ folder: config.data })
  const core = createCore({
    version: manifest.version,
    acceptsCredential: localToken(config.token),
    records: store.records,
    log: { error: (message) => void process.stderr.write(`${message}\n`) },
    harnesses: [],
    newId: randomUUID
  })
  return {
    core,
    close: () => {
      core.close()
      store.close()
    }
  }
}
