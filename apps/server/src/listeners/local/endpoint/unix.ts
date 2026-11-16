import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Endpoint } from './endpoint.ts'

/**
 * macOS and Linux: a Unix socket in a new folder that only this user can enter.
 * The path stays well under the 104 characters macOS allows for a socket path.
 */
export function createEndpoint(): Endpoint {
  const address = join(mkdtempSync(join(tmpdir(), 'core-')), 'core.sock')
  return { address, remove: () => rmSync(dirname(address), { recursive: true, force: true }) }
}
