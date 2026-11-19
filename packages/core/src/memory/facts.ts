import { FACT_KINDS, FACT_MAX_LENGTH, FACT_ORIGINS, type FactKind, factIdSchema, factKindSchema, turnIdSchema } from '@repo/protocol'
import { z } from 'zod'
import type { StoredRecord } from '../ports/records.ts'

/**
 * Facts as records (docs/SPEC.md, sections 5.2 and 10.2).
 *
 * A fact is never changed in place. Each version is a record of type `memory.fact` carrying the fact's own
 * identifier: a later record with the same identifier is a new version of it (an update, or the user's
 * correction). A record that `replaces` another fact ends that one: it is kept as history, no longer true.
 * Forgetting is an erasure (`ERASURE` in the records port) naming every version, which empties them.
 */

/** The type of a fact record: one version of one fact. */
export const FACT = 'memory.fact'

const factRecordSchema = z.object({
  /** The fact this is a version of. */
  fact: factIdSchema,
  text: z.string().min(1).max(FACT_MAX_LENGTH),
  kind: factKindSchema,
  origin: z.enum(FACT_ORIGINS),
  /** The turns it was learned from. */
  sources: z.array(turnIdSchema),
  /** When the fact was first learned, carried from version to version. */
  since: z.string(),
  /** The fact this one makes no longer true. */
  replaces: factIdSchema.optional()
})

/** The payload of a fact record. */
export type FactRecord = z.infer<typeof factRecordSchema>

/** Read the payload of a fact record. Nothing for one this version cannot read, or one that was erased. */
export function readFactRecord(payload: unknown): FactRecord | undefined {
  const read = factRecordSchema.safeParse(payload)
  return read.success ? read.data : undefined
}

/** A fact as the core holds it: its latest version, and where it stands. */
export interface KnownFact extends FactRecord {
  /** When its latest version was written. */
  at: string
  /** The record of its latest version. */
  record: string
  /** Every record it was written in, oldest first. */
  versions: string[]
  /** The fact that made it no longer true. Nothing while it is true. */
  replacedBy?: string
}

/** The facts the core knows, kept current as records are written. */
export interface FactBook {
  /** Take in a record, as read or as just written. Records of other types, or erased, are passed over. */
  take(record: StoredRecord): void
  /** Drop a fact that was erased, with every version of it. */
  drop(fact: string): void
  /** The facts true now, by kind in the order of `FACT_KINDS`, then oldest first. */
  current(): KnownFact[]
  /** A fact true now, by its identifier. */
  get(fact: string): KnownFact | undefined
  /** The fact whose latest version is this record, while it is true. */
  byRecord(record: string): KnownFact | undefined
  /** The records to erase to forget a fact: its versions, and those of the facts it replaced before it. */
  recordsToForget(fact: string): string[]
  /** The turns a fact was learned from, in any of its versions and those of the facts it replaced before it. */
  turnsToForget(fact: string): string[]
  /** Changes with every fact taken or dropped. */
  revision(): number
}

export function createFactBook(records: readonly StoredRecord[] = []): FactBook {
  const facts = new Map<string, KnownFact>()
  const latest = new Map<string, string>()
  /** The turns each fact came from, in every version: a later version may name others than the first. */
  const learnedFrom = new Map<string, Set<string>>()
  let revision = 0

  const book: FactBook = {
    take(record) {
      if (record.type !== FACT) return
      const payload = readFactRecord(record.payload)
      if (!payload) return
      const earlier = facts.get(payload.fact)
      if (earlier) latest.delete(earlier.record)
      const replaces = payload.replaces ?? earlier?.replaces
      const fact: KnownFact = {
        ...payload,
        ...(replaces === undefined ? {} : { replaces }),
        // The first version's date stands, whatever a later version says.
        since: earlier?.since ?? payload.since,
        at: record.at,
        record: record.id,
        versions: [...(earlier?.versions ?? []), record.id],
        ...(earlier?.replacedBy === undefined ? {} : { replacedBy: earlier.replacedBy })
      }
      facts.set(fact.fact, fact)
      latest.set(record.id, fact.fact)
      learnedFrom.set(fact.fact, new Set([...(learnedFrom.get(fact.fact) ?? []), ...payload.sources]))
      if (payload.replaces !== undefined) {
        const replaced = facts.get(payload.replaces)
        if (replaced && replaced.fact !== fact.fact) facts.set(replaced.fact, { ...replaced, replacedBy: fact.fact })
      }
      revision++
    },

    drop(id) {
      const fact = facts.get(id)
      if (!fact) return
      for (const forgotten of chain(id)) {
        const known = facts.get(forgotten)
        if (known) latest.delete(known.record)
        facts.delete(forgotten)
        learnedFrom.delete(forgotten)
      }
      revision++
    },

    current: () =>
      [...facts.values()]
        .filter((fact) => fact.replacedBy === undefined)
        .sort((one, other) => order(one.kind) - order(other.kind) || one.since.localeCompare(other.since)),

    get(id) {
      const fact = facts.get(id)
      return fact && fact.replacedBy === undefined ? fact : undefined
    },

    byRecord(record) {
      const id = latest.get(record)
      return id === undefined ? undefined : book.get(id)
    },

    recordsToForget: (id) => chain(id).flatMap((fact) => facts.get(fact)?.versions ?? []),

    turnsToForget: (id) => [...new Set(chain(id).flatMap((fact) => [...(learnedFrom.get(fact) ?? [])]))],

    revision: () => revision
  }

  /** A fact and every fact it replaced before it, however far back. */
  const chain = (id: string): string[] => {
    const found: string[] = []
    let next: string | undefined = id
    while (next !== undefined && !found.includes(next) && facts.has(next)) {
      found.push(next)
      next = facts.get(next)?.replaces
    }
    return found
  }

  for (const record of records) book.take(record)
  return book
}

const order = (kind: FactKind) => FACT_KINDS.indexOf(kind)
