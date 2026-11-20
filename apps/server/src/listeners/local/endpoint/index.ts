import type { Endpoint } from './endpoint.ts'
import { createEndpoint as unix } from './unix.ts'
import { createEndpoint as win32 } from './win32.ts'

/** A fresh endpoint, of the kind this system uses. macOS and Linux behave the same and share a file. */
export const createEndpoint: () => Endpoint = process.platform === 'win32' ? win32 : unix
