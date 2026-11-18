import type { CodexSandbox } from './system.ts'

/**
 * macOS and Linux: Codex's sandbox (Seatbelt, bubblewrap) needs no setting to refuse writes and the network, and
 * holds a permission profile's reading as well; a command it cannot hold, it refuses rather than run unconfined.
 */
export const unix: CodexSandbox = {
  server: [],
  confined: {},
  holdsReading: async () => true
}
