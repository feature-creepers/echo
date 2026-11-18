import { type AccessUse, accessUseSchema, type FileChange, type FileDiff } from '@repo/protocol'
import { z } from 'zod'
import type { Blobs } from '../ports/blobs.ts'
import type { Computer } from '../ports/computer.ts'
import { ERASURE, type Records } from '../ports/records.ts'
import { COMPARED_LIMIT, countChanges, DIFF_LIMITS, diffText, textOf } from './diff.ts'

/**
 * What the assistant did on the computer, kept as records (docs/SPEC.md, section 12.2): every use of a file or a
 * command, what was decided and how it went, and, for a change to a file, its previous version, so the person
 * can put it back. A file the assistant created can go to the core's trash. A command cannot be undone.
 *
 * A change made also keeps the version it left, and the lines it added and removed, so the person can review it
 * as a diff at any time, one use at a time or a whole turn at once, even after the file changed again.
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
const leftSchema = z.object({
  path: z.string(),
  fingerprint: z.string().optional(),
  status: z.enum(['created', 'changed', 'deleted']).optional(),
  added: z.number().optional(),
  removed: z.number().optional(),
  binary: z.boolean().optional(),
  large: z.boolean().optional()
})
const useRecordSchema = accessUseSchema.omit({ outcome: true, undo: true, changes: true }).extend({
  /** The files' versions before the change. */
  kept: z.array(keptSchema).optional(),
  /** Files that did not exist before it: those it created. */
  created: z.array(z.string()).optional()
})
const outcomeRecordSchema = z.object({
  use: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  /**
   * What each file held once the change was made, to tell later whether it changed since: its fingerprint, which is
   * the hash its version is kept under. Since changes are reviewed as diffs, also what the change did to it, with the
   * lines it added and removed; records from before have only the fingerprint, and their version was not kept.
   */
  after: z.array(leftSchema).optional()
})
const undoRecordSchema = z.object({ use: z.string(), kind: z.enum(['restore', 'trash']), at: z.string(), moved: z.array(z.string()).optional() })

type UseRecord = z.infer<typeof useRecordSchema>
type OutcomeRecord = z.infer<typeof outcomeRecordSchema>
type UndoRecord = z.infer<typeof undoRecordSchema>
type Left = z.infer<typeof leftSchema>

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
  /**
   * What a use changed, file by file, as diffs; or what every use of a turn changed, each file once, from before the
   * first change to it to after the last. Nothing when there is no such use.
   */
  diff(of: { use: string } | { turn: string }): Promise<FileDiff[] | undefined>
  /** For each turn, its uses that changed files, and the files as the turn left them, with the lines added and removed in all. */
  changes(turns: readonly string[]): Promise<{ turn: string; uses: AccessUse[]; files: FileChange[] }[]>
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

/** How many turns' changes, counted in all, are kept at hand: a thread read again need not count them again. */
const TURNS_AT_HAND = 100

/** The actions that change files, which have a diff. */
const CHANGING = new Set<AccessUse['action']>(['create', 'change', 'delete'])

/** A version of a file as far as it can be compared: its bytes, or why there are none. */
type Side = Uint8Array | 'large' | 'missing'

/** What a change did to a file, counted: the lines added and removed, or why they are not. */
function counted(before: Side, after: Side): Pick<Left, 'added' | 'removed' | 'binary' | 'large'> {
  if (before === 'missing' || after === 'missing') return {}
  if (before === 'large' || after === 'large' || before.byteLength > COMPARED_LIMIT || after.byteLength > COMPARED_LIMIT) return { large: true }
  const [old, next] = [textOf(before), textOf(after)]
  if (old === undefined || next === undefined) return { binary: true }
  return countChanges(old, next)
}

const NOTHING = new Uint8Array()

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
    const changes = outcome?.ok ? (outcome.after ?? []).flatMap(changeOf) : []
    return {
      ...shown,
      ...(outcome ? { outcome: { ok: outcome.ok, ...(outcome.error === undefined ? {} : { error: outcome.error }) } } : {}),
      ...(kind ? { undo: { kind, ...(undo ? { done: undo.at } : {}) } } : {}),
      ...(changes.length > 0 ? { changes } : {})
    }
  }

  /** Where a use found a file before it changed it: nothing there (it created it), the version kept, or none kept. */
  const before = (use: UseRecord, path: string): Side => {
    if (use.created?.includes(path)) return NOTHING
    const kept = use.kept?.find((one) => one.path === path)
    if (!kept) return 'large'
    return versions.get(kept.hash) ?? 'missing'
  }

  /** What a change left in a file: its version, kept under its hash, and what it did, counted. */
  const left = async (use: UseRecord, path: string): Promise<Left> => {
    if (!computer) return { path }
    const bytes = await computer.read(path, VERSION_LIMIT).catch(() => undefined)
    const status = use.created?.includes(path) ? 'created' : bytes === undefined ? 'deleted' : 'changed'
    if (bytes === 'too-large') return { ...withFingerprint(path, await computer.fingerprint(path).catch(() => undefined)), status, large: true }
    if (bytes === undefined) return { path, status, ...counted(before(use, path), NOTHING) }
    return { path, fingerprint: versions.put(bytes), status, ...counted(before(use, path), bytes) }
  }

  /**
   * A file as a use, or a turn, left it, from the first use that changed it to the last: both versions as far as
   * they can be compared. When the version the last one left was not kept (a change recorded before versions
   * were), the file as it is now stands in for it.
   */
  const sides = async (path: string, first: Entry, last: Entry): Promise<{ status: FileChange['status']; before: Side; after: Side; now: boolean }> => {
    const created = first.use.created?.includes(path) === true
    const leftBy = last.outcome?.after?.find((one) => one.path === path)
    const deleted = leftBy?.status === 'deleted'
    const status = created ? 'created' : deleted ? 'deleted' : 'changed'
    const old = before(first.use, path)
    if (deleted) return { status, before: old, after: NOTHING, now: false }
    if (leftBy?.large) return { status, before: old, after: 'large', now: false }
    const kept = leftBy?.fingerprint === undefined ? undefined : versions.get(leftBy.fingerprint)
    if (kept) return { status, before: old, after: kept, now: false }
    const now = computer ? await computer.read(path, VERSION_LIMIT).catch(() => undefined) : undefined
    return { status, before: old, after: now === 'too-large' ? 'large' : (now ?? 'missing'), now: true }
  }

  /** The uses that changed files, in the order they were made: one, or those of a turn, but those refused or failed. */
  const changing = (of: { use: string } | { turn: string }): Entry[] | undefined => {
    if ('use' in of) {
      const entry = entries.get(of.use)
      return entry ? [entry].filter(made) : undefined
    }
    return [...entries.values()].filter((entry) => entry.use.turn === of.turn && made(entry))
  }

  /** Each file the uses changed, once, with the first use that changed it and the last. */
  const touched = (list: readonly Entry[]) => {
    const files = new Map<string, { first: Entry; last: Entry; uses: number }>()
    for (const entry of list) {
      for (const path of new Set(entry.use.paths)) {
        const known = files.get(path)
        if (known) {
          known.last = entry
          known.uses++
        } else files.set(path, { first: entry, last: entry, uses: 1 })
      }
    }
    return files
  }

  /** The changes of each turn, counted, kept at hand while its uses stay as they are. */
  const atHand = new Map<string, { key: string; files: FileChange[] }>()

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
      // A change made keeps the version it left of each file, for its diff, and for undo to tell whether it changed since.
      const changed = ok && computer && CHANGING.has(entry.use.action)
      const after = changed ? await Promise.all([...new Set(entry.use.paths)].map((path) => left(entry.use, path))) : undefined
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

    async diff(of) {
      const list = changing(of)
      if (!list) return undefined
      const files: FileDiff[] = []
      let budget = DIFF_LIMITS.characters
      for (const [path, { first, last }] of touched(list)) {
        const { status, before: old, after: next, now } = await sides(path, first, last)
        // A file the turn created and then deleted was not changed by it.
        if (old === NOTHING && next === NOTHING) continue
        const marks = { ...(now ? { now: true } : {}) }
        const empty = { path, status, added: 0, removed: 0, hunks: [], lines: { before: 0, after: 0 } }
        const count = counted(old, next)
        if (old === 'missing' || next === 'missing') files.push({ ...empty, ...marks, missing: true })
        else if (count.binary) files.push({ ...empty, ...marks, binary: true })
        else if (count.large || old === 'large' || next === 'large') files.push({ ...empty, ...marks, large: true })
        else {
          const diff = diffText(textOf(old) ?? '', textOf(next) ?? '', { characters: Math.max(0, budget) })
          budget -= diff.characters
          files.push({
            path,
            status,
            added: diff.added,
            removed: diff.removed,
            hunks: diff.hunks,
            lines: diff.lines,
            ...(diff.cut ? { cut: true } : {}),
            ...(diff.clipped ? { clipped: true } : {}),
            ...(diff.endings ? { endings: true } : {}),
            ...marks
          })
        }
      }
      return files
    },

    async changes(turns) {
      const answer: { turn: string; uses: AccessUse[]; files: FileChange[] }[] = []
      for (const turn of turns) {
        const list = changing({ turn }) ?? []
        if (list.length === 0) continue
        const key = list.map((entry) => `${entry.use.id}:${entry.outcome ? 1 : 0}`).join(',')
        let files = atHand.get(turn)?.key === key ? atHand.get(turn)?.files : undefined
        if (!files) {
          files = []
          for (const [path, { first, last, uses }] of touched(list)) {
            // A file one use changed was counted when it was made; one changed several times is counted again whole.
            const own = uses === 1 ? (last.outcome?.after ?? []).flatMap(changeOf).find((one) => one.path === path) : undefined
            if (own) {
              files.push(own)
              continue
            }
            const { status, before: old, after: next } = await sides(path, first, last)
            if (old === NOTHING && next === NOTHING) continue
            const count = counted(old, next)
            files.push({
              path,
              status,
              added: count.added ?? 0,
              removed: count.removed ?? 0,
              ...(count.binary ? { binary: true } : {}),
              ...(count.large ? { large: true } : {})
            })
          }
          atHand.delete(turn)
          atHand.set(turn, { key, files })
          for (const oldest of atHand.keys()) {
            if (atHand.size <= TURNS_AT_HAND) break
            atHand.delete(oldest)
          }
        }
        answer.push({ turn, uses: list.map(view), files })
      }
      return answer
    },

    expire() {
      const before = now().getTime() - KEPT_MS
      const all = records.read([ACCESS_USE, ACCESS_OUTCOME, ACCESS_UNDO]).filter((record) => record.payload !== null)
      const old = all.filter((record) => Date.parse(record.at) < before)
      if (old.length === 0) return
      // The versions a record keeps: those before a change, and those it left.
      const hashes = (list: typeof all) =>
        new Set(
          list.flatMap((record) =>
            record.type === ACCESS_USE
              ? (useRecordSchema.safeParse(record.payload).data?.kept ?? []).map((one) => one.hash)
              : record.type === ACCESS_OUTCOME
                ? (outcomeRecordSchema.safeParse(record.payload).data?.after ?? []).flatMap((one) => (one.fingerprint === undefined ? [] : [one.fingerprint]))
                : []
          )
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

/** Whether a use made a change to files: allowed, and not reported failed. */
const made = (entry: { use: UseRecord; outcome?: OutcomeRecord | undefined }) =>
  CHANGING.has(entry.use.action) && entry.use.decision !== 'refused' && entry.outcome?.ok !== false

/** What a change did to a file, as the person is shown it: nothing for a record kept before changes were counted. */
function changeOf(left: Left): FileChange[] {
  if (left.status === undefined) return []
  if (left.added === undefined && !left.binary && !left.large) return []
  return [
    {
      path: left.path,
      status: left.status,
      added: left.added ?? 0,
      removed: left.removed ?? 0,
      ...(left.binary ? { binary: true } : {}),
      ...(left.large ? { large: true } : {})
    }
  ]
}

/** A use without the fields left empty, as it is kept. */
function withoutEmpty(use: NewUse): NewUse {
  const { kept, created, ...rest } = use
  return { ...rest, ...(kept && kept.length > 0 ? { kept } : {}), ...(created && created.length > 0 ? { created } : {}) }
}
