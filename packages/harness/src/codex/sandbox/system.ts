import type { Launch } from '../../process/cli.ts'

/** How Codex's sandbox holds a session's commands on one system. */
export interface CodexSandbox {
  /** Settings the server starts with, as command-line arguments: what every conversation on it runs in by default. */
  server: string[]
  /** What a conversation whose commands are held to a permission profile adds to its configuration. */
  confined: Record<string, unknown>
  /**
   * Whether this computer's sandbox holds a command's reading to chosen places, not only its writing. A check that
   * runs Codex, so its answer is kept by the caller. `folder` is the adapter's own, which nothing granted reaches.
   */
  holdsReading(launch: Launch, folder: string): Promise<boolean>
}

/** The name of the permission profile a confined conversation runs under. */
export const PROFILE = 'granted'
