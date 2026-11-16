/** Where a client stands with its core. */
export type CoreLink =
  /** The core is being started or the handshake is under way. */
  | { state: 'starting' }
  | { state: 'connected'; core: { version: string } }
  /** There is no link, and why, in words for the user. */
  | { state: 'failed'; reason: string }
