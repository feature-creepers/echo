import { type AccessUse, accessUseSchema } from '@repo/protocol'
import { z } from 'zod'
import type { Blobs } from '../ports/blobs.ts'
import type { Computer } from '../ports/computer.ts'
import { ERASURE, type Records } from '../ports/records.ts'

/**
 * What the assistant did on the computer, kept as records (docs/SPEC.md, section 12.2): every use of a file or a
 * command, what was decided and how it went, and, for a change to a file, its previous version, so the person
 * can put it back. A file the assistant created can go to the core's trash. A command cannot be undone.
 *
 * Kept 30 days: older records are erased when the core starts, and the versions only they kept with them.
 */

/** The type of the record written when a use is decided. */
export const ACCESS_USE = 'access.use'
/** The type of the record written when the harness says how a use went. */
export const ACCESS_OUTCOME = 'access.outcome'
/** The type of the record written when a use is undone. */
export const ACCESS_UNDO = 'access.undo'

/** How long the activity is kept. */
export const KEPT_MS = 30 * 24 * 60 * 60 * 1000
/** The largest file whose previous version is kept: a larger one is changed without a way back. */
export const VERSION_LIMIT = 20 * 1024 * 1024

const keptSchema = z.object({ path: z.string(), hash: z.string(), size: z.number() })
const useRecordSchema = accessUseSchema.omit({ outcome: true, undo: true }).extend({
  /** The files' versions before the change. */
  kept: z.array(keptSchema).optional(),
  /** Files that did not exist before it: those it created. */
  created: z.array(z.string()).optional()
})
const outcomeRecordSchema = z.object({
  use: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  /** What each file held once the change was made, to tell later whether it changed since. */
  after: z.array(z.object({ path: z.string(), fingerprint: z.string().optional() })).optional()
})
const undoRecordSchema = z.object({ use: z.string(), kind: z.enum(['restore', 'trash']), at: z.string(), moved: z.array(z.string()).optional() })

type UseRecord = z.infer<typeof useRecordSchema>
type OutcomeRecord = z.infer<typeof outcomeRecordSchema>
type UndoRecord = z.infer<typeof undoRecordSchema>

/** A use as the core decided it, before it is kept. */
export type NewUse = Omit<UseRecord, 'id' | 'at'>

export type UndoResult = { outcome: 'done' | 'changed' | 'gone'; use?: AccessUse }

export interface Activity {
  /** Before a change runs: keep the version of each file that exists, and note those that do not. */
  keep(paths: readonly string[]): Promise<{ kept: UseRecord['kept']; created: string[] }>
  /** Keep a use as it was decided, and tell the listeners. */
  record(use: NewUse): AccessUse
  /** How a use went, once the harness says. For a change made, what the files hold now is noted. */
  outcome(id: string, outcome: { ok: boolean; error?: string | undefined }): Promise<void>
  /** The uses, the latest first, from before `before` when given. */
  read(limit: number, before?: string): { uses: AccessUse[]; more: boolean }
  /** Put back the files' previous versions, or move the files it created to the trash. */
  undo(id: string, anyway: boolean): Promise<UndoResult>
  /** Erase what is older than 30 days. */
  expire(): void
  onUse(listener: (use: AccessUse) => void): () => void
}

interface Entry {
  use: UseRecord
  outcome?: OutcomeRecord
  undo?: UndoRecord
}

export interface ActivityOptions {
  records: Records
  /** Where previous versions of files are kept. They are removed from it once they expire, when it can. */
  versions: Blobs
  computer: Computer | undefined
  now: () => Date
  newId: () => string
}

/** The most an error from the harness is kept to: the start of it says what went wrong. */
const ERROR_KEPT = 300

export function createActivity({ records, versions, computer, now, newId }: ActivityOptions): Activity {
  const entries = new Map<string, Entry>()
  const listeners = new Set<(use: AccessUse) => void>()

  for (const record of records.read([ACCESS_USE, ACCESS_OUTCOME, ACCESS_UNDO])) {
    if (record.payload === null) continue
    if (record.type === ACCESS_USE) {
      const read = useRecordSchema.safeParse(record.payload)
      if (read.success) entries.set(read.data.id, { use: read.data })
    } else if (record.type === ACCESS_OUTCOME) {
      const read = outcomeRecordSchema.safeParse(record.payload)
      const entry = read.success ? entries.get(read.data.use) : undefined
      if (entry && read.success) entry.outcome = read.data
    } else {
      const read = undoRecordSchema.safeParse(record.payload)
      const entry = read.success ? entries.get(read.data.use) : undefined
      if (entry && read.success) entry.undo = read.data
    }
  }

  const view = ({ use, outcome, undo }: Entry): AccessUse => {
    const { kept, created, ...shown } = use
    const undoable = use.decision !== 'refused' && outcome?.ok !== false
    const kind = !undoable ? undefined : (kept?.length ?? 0) > 0 ? 'restore' : (created?.length ?? 0) > 0 ? 'trash' : undefined
    return {
      ...shown,
      ...(outcome ? { outcome: { ok: outcome.ok, ...(outcome.error === undefined ? {} : { error: outcome.error }) } } : {}),
      ...(kind ? { undo: { kind, ...(undo ? { done: undo.at } : {}) } } : {})
    }
  }

  const tell = (entry: Entry) => {
    const shown = view(entry)
    for (const listener of listeners) listener(shown)
    return shown
  }

  return {
    async keep(paths) {
      const kept: NonNullable<UseRecord['kept']> = []
      const created: string[] = []
      if (!computer) return { kept, created }
      for (const path of paths) {
        const bytes = await computer.read(path, VERSION_LIMIT).catch(() => undefined)
        if (bytes === undefined) created.push(path)
        else if (bytes !== 'too-large') kept.push({ path, hash: versions.put(bytes), size: bytes.byteLength })
      }
      return { kept, created }
    },

    record(asked) {
      const use: UseRecord = { id: newId(), at: now().toISOString(), ...withoutEmpty(asked) }
      records.append([{ type: ACCESS_USE, payload: use }])
      const entry: Entry = { use }
      entries.set(use.id, entry)
      return tell(entry)
    },

    async outcome(id, { ok, error }) {
      const entry = entries.get(id)
      if (!entry || entry.outcome) return
      const changed = ok && computer && (entry.use.action === 'create' || entry.use.action === 'change')
      const after = changed
        ? await Promise.all(entry.use.paths.map(async (path) => withFingerprint(path, await computer.fingerprint(path).catch(() => undefined))))
        : undefined
      const outcome: OutcomeRecord = {
        use: id,
        ok,
        ...(error === undefined || ok ? {} : { error: error.slice(0, ERROR_KEPT) }),
        ...(after ? { after } : {})
      }
      records.append([{ type: ACCESS_OUTCOME, payload: outcome }])
      entry.outcome = outcome
      tell(entry)
    },

    read(limit, before) {
      const all = [...entries.values()].reverse()
      const from = before === undefined ? 0 : all.findIndex((entry) => entry.use.id === before) + 1
      const page = all.slice(from, from + limit)
      return { uses: page.map(view), more: from + limit < all.length }
    },

    async undo(id, anyway) {
      const entry = entries.get(id)
      const shown = entry ? view(entry) : undefined
      if (!entry || !computer || !shown?.undo || shown.undo.done) return { outcome: 'gone' }
      const after = (path: string) => entry.outcome?.after?.find((one) => one.path === path)?.fingerprint
      const kept = entry.use.kept ?? []
      const created = entry.use.created ?? []

      // What each file holds now, against what the change left: a file changed since is not overwritten unasked.
      const holding = await Promise.all(
        [...kept.map((one) => one.path), ...created].map(async (path) => [path, await computer.fingerprint(path).catch(() => undefined)] as const)
      )
      const current = new Map(holding)
      if (!anyway) {
        for (const one of kept) {
          const left = after(one.path)
          const holds = current.get(one.path)
          if (holds !== one.hash && holds !== left) return { outcome: 'changed', use: shown }
        }
        for (const path of created) {
          const holds = current.get(path)
          if (holds !== undefined && holds !== after(path)) return { outcome: 'changed', use: shown }
        }
      }

      let did = false
      for (const one of kept) {
        const bytes = versions.get(one.hash)
        if (!bytes) continue
        await computer.write(one.path, bytes)
        did = true
      }
      const moved: string[] = []
      for (const path of created) {
        if (current.get(path) === undefined) continue
        moved.push(await computer.trash(path))
        did = true
      }
      if (!did) return { outcome: 'gone', use: shown }
      const undo: UndoRecord = {
        use: id,
        kind: shown.undo.kind,
        at: now().toISOString(),
        ...(moved.length > 0 ? { moved } : {})
      }
      records.append([{ type: ACCESS_UNDO, payload: undo }])
      entry.undo = undo
      return { outcome: 'done', use: tell(entry) }
    },

    expire() {
      const before = now().getTime() - KEPT_MS
      const all = records.read([ACCESS_USE, ACCESS_OUTCOME, ACCESS_UNDO]).filter((record) => record.payload !== null)
      const old = all.filter((record) => Date.parse(record.at) < before)
      if (old.length === 0) return
      const hashes = (list: typeof all) =>
        new Set(
          list.flatMap((record) => (record.type === ACCESS_USE ? (useRecordSchema.safeParse(record.payload).data?.kept ?? []).map((one) => one.hash) : []))
        )
      const going = hashes(old)
      const staying = hashes(all.filter((record) => !old.includes(record)))
      records.append([{ type: ERASURE, payload: { records: old.map((record) => record.id) } }])
      for (const record of old) {
        const id = (record.payload as { id?: unknown; use?: unknown }).id ?? (record.payload as { use?: unknown }).use
        if (record.type === ACCESS_USE && typeof id === 'string') entries.delete(id)
      }
      for (const hash of going) if (!staying.has(hash)) versions.remove?.(hash)
    },

    onUse(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

const withFingerprint = (path: string, fingerprint: string | undefined) => (fingerprint === undefined ? { path } : { path, fingerprint })

/** A use without the fields left empty, as it is kept. */
function withoutEmpty(use: NewUse): NewUse {
  const { kept, created, ...rest } = use
  return { ...rest, ...(kept && kept.length > 0 ? { kept } : {}), ...(created && created.length > 0 ? { created } : {}) }
}
