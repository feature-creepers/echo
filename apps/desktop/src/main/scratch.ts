import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** What a self-check's own folder in the temporary folder is called, before its random ending. */
const PREFIX = 'self-check-'
/** How old the folder of an earlier self-check must be to be removed: no check still running is that old. */
const STALE_MS = 60 * 60 * 1000

/**
 * A folder of its own for a self-check, once the folders earlier ones left are removed. On Windows, the system still
 * holds some of the files Chromium keeps there when a check ends, so a check cannot always remove its own folder;
 * the next one does.
 */
export function selfCheckFolder(temporary: string, now = Date.now()): string {
  for (const name of readdirSync(temporary)) {
    if (!name.startsWith(PREFIX)) continue
    const path = join(temporary, name)
    try {
      const found = statSync(path)
      if (found.isDirectory() && now - found.mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true })
    } catch {
      // Still held, or gone meanwhile: left for the next check.
    }
  }
  return mkdtempSync(join(temporary, PREFIX))
}
