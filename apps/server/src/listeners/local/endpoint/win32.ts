import { randomBytes } from 'node:crypto'
import type { Endpoint } from './endpoint.ts'

/**
 * Windows: a named pipe with a name nobody can guess. Other users of the machine can still reach
 * a named pipe, which is why a client must also present the token. Windows removes the pipe by itself.
 */
export function createEndpoint(): Endpoint {
  return { address: `\\\\.\\pipe\\core-${randomBytes(16).toString('hex')}`, remove: () => undefined }
}
