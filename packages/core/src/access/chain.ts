import type { ActivityCheck } from '@repo/protocol'
import { z } from 'zod'
import type { NewRecord, StoredRecord } from '../ports/records.ts'
import { sha256 } from './sha256.ts'

/**
 * The activity as a chain (docs/SPEC.md, section 12.2, the signed log). Each record of the activity is written with
 * a seal, in the same append: the hash of the record and of the seal before it. Changing a record, taking one out,
 * or putting one back in another order breaks the chain from there on, so the log cannot be changed unseen. Only
 * the records the 30 days let go are erased, with their seals, from the oldest on; the first seal kept is the
 * chain's anchor. Taking away the latest records leaves no trace in the log itself: an export carries the last
 * hash, so the person can hold the log to it later.
 */

/** The type of the record that seals the activity record written just before it. */
export const ACCESS_SEAL = 'access.seal'

/** The hash before the first seal. */
export const GENESIS = '0'.repeat(64)

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const sealSchema = z.object({ previous: hashSchema, hash: hashSchema })
export type Seal = z.infer<typeof sealSchema>

/** JSON with its keys in order and nothing undefined, so the same content always reads the same once kept. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}

/** The seal of a record written after the one whose hash is `previous`. */
export function sealOf(previous: string, record: NewRecord): Seal {
  return { previous, hash: sha256(`${previous}\n${record.type}\n${canonical(record.payload)}`) }
}

/**
 * Check the chain: the activity's records and their seals, in the order they were written. `expiredBefore` is the
 * time before which a record may have been erased by the 30 days; one erased after it is a record taken out.
 */
export function checkChain(records: readonly StoredRecord[], expiredBefore: number): ActivityCheck {
  let sealed = 0
  let unsealed = 0
  let since: string | undefined
  let head: string | undefined
  /** The hash the next seal must follow, unknown at the start and after the records the 30 days let go. */
  let expected: string | undefined
  let pending: StoredRecord | undefined

  const broken = (record: StoredRecord, reason: NonNullable<ActivityCheck['problem']>['reason']): ActivityCheck => ({
    state: 'broken',
    sealed,
    unsealed,
    head: head ?? null,
    ...(since === undefined ? {} : { since }),
    problem: { at: record.at, reason }
  })
  const expired = (record: StoredRecord) => Date.parse(record.at) < expiredBefore

  for (const record of records) {
    if (record.type !== ACCESS_SEAL) {
      if (pending) {
        // A record written before records were sealed is only counted; one without its seal after is a broken chain.
        if (head !== undefined) return broken(pending, 'unsealed')
        unsealed++
      }
      pending = record
      continue
    }
    const sealing = pending
    pending = undefined
    if (!sealing) return broken(record, 'missing')
    if (record.payload === null || sealing.payload === null) {
      if (!expired(sealing)) return broken(sealing, 'erased')
      expected = undefined
      continue
    }
    const seal = sealSchema.safeParse(record.payload)
    if (!seal.success) return broken(sealing, 'changed')
    if (expected !== undefined && seal.data.previous !== expected) return broken(sealing, 'missing')
    if (sealOf(seal.data.previous, sealing).hash !== seal.data.hash) return broken(sealing, 'changed')
    sealed++
    since ??= sealing.at
    head = seal.data.hash
    expected = head
  }
  if (pending) {
    if (head !== undefined) return broken(pending, 'unsealed')
    unsealed++
  }
  return {
    state: sealed === 0 && unsealed === 0 ? 'empty' : 'intact',
    sealed,
    unsealed,
    head: head ?? null,
    ...(since === undefined ? {} : { since })
  }
}
