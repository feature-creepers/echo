import type { Allowance } from '@repo/protocol'
import type { ComputerUse } from '../ports/harness.ts'
import type { CommandReading } from './commands.ts'

/**
 * What the person allowed for the session: a yes that covers more than the one use it answered (docs/SPEC.md,
 * section 12.2). For a command, every use of the same program and subcommand (`git commit`, `npm run`,
 * `python`), its paths still checked; for a change to a file, any change in the same folder or below it. It is
 * kept in memory only: it ends when the app quits, when the access changes, or when everything is stopped.
 */
export interface Allowances {
  list(): Allowance[]
  /** Whether a use is covered. A command that destroys never is. */
  covers(use: ComputerUse, reading: CommandReading | undefined): boolean
  /** Allow for the session what this use is: its commands' keys, or the folders of its files. */
  allow(use: ComputerUse, reading: CommandReading | undefined): void
  /** Take one back. False when there is no such one. */
  forget(id: string): boolean
  clear(): void
  /** Be told each time the list changes. Returns a function that stops the telling. */
  onChange(listener: (allowances: Allowance[]) => void): () => void
}

/** The folder a file is in, whatever the system's separator. */
export function folderOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path.slice(0, at + 1) || path : path.slice(0, at)
}

/** Whether a path is a folder or inside it, by its words. The adapter resolved both already. */
export function within(path: string, folder: string): boolean {
  const trim = (value: string) => value.replace(/[\\/]+$/, '')
  const [one, other] = [trim(path), trim(folder)]
  return one === other || one.startsWith(`${other}/`) || one.startsWith(`${other}\\`) || (other === '' && one.startsWith('/'))
}

export function createAllowances({ newId, now }: { newId: () => string; now: () => Date }): Allowances {
  let allowances: Allowance[] = []
  const listeners = new Set<(allowances: Allowance[]) => void>()
  const changed = () => {
    for (const listener of listeners) listener(allowances)
  }
  const commands = () => new Set(allowances.filter((one) => one.kind === 'command').map((one) => one.subject))
  const folders = () => allowances.filter((one) => one.kind === 'change').map((one) => one.subject)

  return {
    list: () => allowances,

    covers(use, reading) {
      if (use.action === 'run') {
        if (!reading || reading.destructive || reading.keys.length === 0) return false
        const allowed = commands()
        return reading.keys.every((key) => allowed.has(key))
      }
      if (use.action !== 'create' && use.action !== 'change') return false
      const allowed = folders()
      return use.paths.length > 0 && use.paths.every((path) => allowed.some((folder) => within(path, folder)))
    },

    allow(use, reading) {
      const at = now().toISOString()
      const added: Allowance[] = []
      if (use.action === 'run') {
        if (!reading || reading.destructive) return
        const allowed = commands()
        for (const key of reading.keys) if (!allowed.has(key)) added.push({ id: newId(), kind: 'command', subject: key, at })
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
