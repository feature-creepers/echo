import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../../process/run.ts'
import { type CodexSandbox, PROFILE } from './system.ts'

/** How long the check has: starting a sandbox the first time takes a few seconds. */
const CHECK_TIMEOUT_MS = 30_000

/** What the check prints once it ran in the sandbox. */
const HELD = 'ECHO_SANDBOX_HELD'

/**
 * Windows. A conversation that runs no command needs a kind of sandbox chosen all the same, for its read-only one
 * to exist: the server starts with the restricted token, which needs no administrator rights and no set-up. That one
 * holds writing only. A conversation whose commands are held to a permission profile, reading included, runs in
 * Windows' own process isolation (MXC), on the versions of Windows 11 that have it; elsewhere Codex refuses such a
 * profile rather than run a command unconfined, which the check finds out.
 */
export const win32: CodexSandbox = {
  server: ['-c', 'windows.sandbox="unelevated"'],
  confined: { windows: { sandbox: 'mxc' } },
  async holdsReading(launch, folder) {
    // A file the profile does not reach: the check passes only if the command runs and cannot read it. This also
    // catches settings of the person's own that would put Codex back on its older sandbox, which ignores the profile.
    const outside = join(folder, `held-${randomUUID()}.txt`)
    const secret = randomUUID()
    try {
      await mkdir(folder, { recursive: true })
      await writeFile(outside, secret)
      const filesystem = `{":minimal"="read",":tmpdir"="read"}`
      const { code, stdout } = await run(
        launch.command,
        [
          ...['-c', 'windows.sandbox="mxc"', '-c', `default_permissions="${PROFILE}"`, '-c', `permissions.${PROFILE}.filesystem=${filesystem}`],
          ...['sandbox', '-C', tmpdir(), '--', 'cmd.exe', '/d', '/c', `type "${outside}" & echo ${HELD}`]
        ],
        { env: launch.env, timeoutMs: CHECK_TIMEOUT_MS }
      )
      return code === 0 && stdout.includes(HELD) && !stdout.includes(secret)
    } catch {
      return false
    } finally {
      await rm(outside, { force: true }).catch(() => undefined)
    }
  }
}
