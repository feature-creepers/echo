import type { Allowance } from '@repo/protocol'
import type { ComputerUse } from '../ports/harness.ts'
import { partsFrom } from '../projects/folders.ts'
import type { CommandReading } from './commands.ts'

/**
 * What the person allowed for the session: a yes that covers more than the one use it answered (docs/SPEC.md,
 * section 12.2). For a command, every use of the same program and subcommand (`git commit`, `npm run`,
 * `python`), its paths still checked; for a change to a file, any change in the same folder or below it; for a
 * search of a folder too large to look through first, any such search with the same tool or programs that otherwise
 * only reads. It is kept in memory only: it ends when the app quits, when the access changes, or when everything is
 * stopped.
 */
export interface Allowances {
  list(): Allowance[]
  /**
   * Whether a use is covered. A command that destroys never is while what destroys is always asked, nor one that gives
   * a program a variable, nor one run elevated.
   */
  covers(use: ComputerUse, reading: CommandReading | undefined): boolean
  /** Allow for the session what this use is: its commands' keys, or the folders of its files. */
  allow(use: ComputerUse, reading: CommandReading | undefined): void
  /** Take one back. False when there is no such one. */
  forget(id: string): boolean
  clear(): void
  /** Be told each time the list changes. Returns a function that stops the telling. */
  onChange(listener: (allowances: Allowance[]) => void): () => void
}

/** A yes for the session, by what it covers: a command's program and subcommand, or a walk's program or tool. */
export interface SessionKey {
  kind: 'command' | 'walk'
  subject: string
}

/**
 * What a yes for the session on a use covers: a command line's keys; for one that goes through more than the adapter
 * looked through, a walk for each command that reads, kept apart, so that it never covers a line that does more than
 * read; a search's tool, for one too large to look through. Nothing when no yes for the session may cover it: a line
 * that gives a program a variable, which can make a program allowed run something else (`NODE_OPTIONS`, `PATH`), one
 * run elevated, or one past the walk that does more than read and has no command of its own to allow.
 */
export function sessionKeys(use: ComputerUse, reading: CommandReading | undefined): SessionKey[] {
  if (use.action === 'read') return use.unwalked ? [{ kind: 'walk', subject: use.tool }] : []
  if (use.action !== 'run' || !reading || reading.variables.length > 0 || reading.elevated) return []
  const commands = reading.keys.map((subject): SessionKey => ({ kind: 'command', subject }))
  if (!use.unwalked) return commands
  const reads = new Set(reading.commands.filter((command) => command.readOnly).map((command) => command.key))
  const walks = [...reads].map((subject): SessionKey => ({ kind: 'walk', subject }))
  if (reading.readOnly) return walks
  return commands.length > 0 ? [...commands, ...walks] : []
}

/** The folder a file is in, whatever the system's separator. */
export function folderOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path.slice(0, at + 1) || path : path.slice(0, at)
}

/** Whether a path is a folder or inside it, by its words, a Windows path whatever its capitals. The adapter resolved both already. */
export function within(path: string, folder: string): boolean {
  return partsFrom(folder, path) !== undefined
}

export function createAllowances({
  newId,
  now,
  destroyingAsked
}: {
  newId: () => string
  now: () => Date
  /** Whether what destroys is asked every time, as the person set it: then no yes for the session covers it. */
  destroyingAsked: () => boolean
}): Allowances {
  let allowances: Allowance[] = []
  const listeners = new Set<(allowances: Allowance[]) => void>()
  const changed = () => {
    for (const listener of listeners) listener(allowances)
  }
  const given = (key: SessionKey) => allowances.some((one) => one.kind === key.kind && one.subject === key.subject)
  const folders = () => allowances.filter((one) => one.kind === 'change').map((one) => one.subject)

  return {
    list: () => allowances,

    covers(use, reading) {
      if (use.action === 'run' || use.action === 'read') {
        if (reading?.destructive && destroyingAsked()) return false
        const keys = sessionKeys(use, reading)
        return keys.length > 0 && keys.every(given)
      }
      if (use.action !== 'create' && use.action !== 'change') return false
      const allowed = folders()
      return use.paths.length > 0 && use.paths.every((path) => allowed.some((folder) => within(path, folder)))
    },

    allow(use, reading) {
      const at = now().toISOString()
      const added: Allowance[] = []
      if (use.action === 'run' || use.action === 'read') {
        if (reading?.destructive && destroyingAsked()) return
        for (const key of sessionKeys(use, reading)) if (!given(key)) added.push({ id: newId(), ...key, at })
      } else if (use.action === 'create' || use.action === 'change') {
        const allowed = folders()
        for (const folder of new Set(use.paths.map(folderOf)))
          if (!allowed.some((known) => within(folder, known))) added.push({ id: newId(), kind: 'change', subject: folder, at })
      }
      if (added.length === 0) return
      allowances = [...allowances, ...added]
      changed()
    },

    forget(id) {
      if (!allowances.some((one) => one.id === id)) return false
      allowances = allowances.filter((one) => one.id !== id)
      changed()
      return true
    },

    clear() {
      if (allowances.length === 0) return
      allowances = []
      changed()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
