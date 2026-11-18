import type { Scope } from '@repo/core'

/**
 * Commands held to the scope by the system itself (docs/SPEC.md, sections 12.2 and 12.4).
 *
 * The core reads what a command names, and the approval card is the backstop for what a program works out once it
 * runs. Where the system can, it holds the command too: Claude Code runs it in its sandbox, Seatbelt on macOS and
 * bubblewrap on Linux, given the places granted as the only ones it may change, and the places never reached as
 * ones it may neither read nor change. A command that fails there is never retried outside it.
 */

export interface Confinement {
  /** The places never reached that a session's commands must not read, besides the scope's: the adapter's own folder. */
  never: readonly string[]
  /** Folders programs write to on their own while a command runs: package caches, the temporary folder. */
  caches: readonly string[]
}

/** Whether a path is written as the sandbox reads one: absolute, from the root. */
const rooted = (path: string) => path.startsWith('/')

/**
 * The `sandbox` block of a session's settings, and the rule that lets its commands reach the network, for a
 * session that runs commands. With the whole computer to change, the sandbox still keeps the places never
 * reached out of reach.
 */
export function sandboxSettings(scope: Scope, confinement: Confinement): Record<string, unknown> {
  const protectedPaths = (scope.protected ?? []).flatMap((place) => (place.path === undefined ? [] : [place.path]))
  const never = [...new Set([...protectedPaths, ...confinement.never])].filter(rooted)
  const reopened = [...new Set((scope.protected ?? []).flatMap((place) => place.except ?? []))].filter(rooted)
  const writable =
    scope.computer === 'write' ? ['/'] : [...new Set([...scope.places.filter((place) => place.write).map((place) => place.path), ...confinement.caches])]
  return {
    sandbox: {
      enabled: true,
      // A command that fails in the sandbox is not run again outside it, and the CLI never runs one unconfined by itself.
      allowUnsandboxedCommands: false,
      // Each command is still put to the core first: confinement is a second wall, not a reason to stop asking.
      autoAllowBashIfSandboxed: false,
      filesystem: {
        allowWrite: writable.filter(rooted),
        denyWrite: never,
        denyRead: never,
        ...(reopened.length > 0 ? { allowRead: reopened } : {})
      }
    },
    // The sandbox sends a command's connections through a proxy that lets only listed hosts through. Commands reach
    // the network as before (docs/SPEC.md, section 12.2: a network policy for commands is not built yet).
    permissions: { allow: ['WebFetch(domain:*)'] }
  }
}
