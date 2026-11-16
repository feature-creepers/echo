import { admit, type Admission } from '@repo/core'
import manifest from '../package.json' with { type: 'json' }
import { localToken } from './auth/local-token.ts'
import type { Config } from './config.ts'

/** The core as the listeners see it. */
export interface Core {
  /** Decide whether a client may connect, from the first message it sent. */
  admit(message: unknown): Admission
}

/**
 * Wire the core to what it needs on this machine.
 *
 * This is the only file that knows both the core and the adapters it runs on.
 */
export function compose(config: Config): Core {
  const acceptsCredential = localToken(config.token)
  return {
    admit: (message) => admit(message, { coreVersion: manifest.version, acceptsCredential })
  }
}
