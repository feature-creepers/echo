import { z } from 'zod'
import type { Harness } from '../ports/harness.ts'
import { dayOf, shorten } from './answer.ts'
import type { KnownFact } from './facts.ts'

/**
 * The profile: a few hundred words about the user, drawn from the most important facts and given to every
 * session, so the assistant knows who it talks to before a word is said (docs/SPEC.md, section 10.2).
 * It is written while the assistant sleeps, when the facts changed since the last one.
 */

/** The type of the record that keeps a profile. The latest one is the profile. */
export const PROFILE = 'memory.profile'

const profileRecordSchema = z.object({
  text: z.string().min(1),
  /** Which facts it was written from, as `basisOf` gives it: when they change, it is written again. */
  basis: z.string()
})
export type ProfileRecord = z.infer<typeof profileRecordSchema>

export function readProfileRecord(payload: unknown): ProfileRecord | undefined {
  const read = profileRecordSchema.safeParse(payload)
  return read.success ? read.data : undefined
}

/** The most facts a profile is written from, the most important kinds first. */
const PROFILE_FACTS = 120
/** The most facts listed as they are, when there is no profile yet or they are newer than it. */
const LISTED_FACTS = 40
const PROFILE_LENGTH = 2400

/** Which kinds matter most in a profile: decisions not to question again first, then the people in the user's life. */
const WEIGHT: Record<KnownFact['kind'], number> = { override: 0, person: 1, preference: 2, project: 3, date: 4, other: 5 }

const byImportance = (facts: readonly KnownFact[]) => [...facts].sort((one, other) => WEIGHT[one.kind] - WEIGHT[other.kind] || other.at.localeCompare(one.at))

export const PROFILE_INSTRUCTIONS = [
  'You write the short profile a personal voice assistant reads before every conversation with the person it serves.',
  'You are given the facts it knows about them. Write at most 250 words of plain prose, in English, about "the user": who they are, the people in their life, what they like and how they want things done, what they are working on, and what is coming up.',
  'Keep every decision listed as an override, with its date, so the assistant does not raise the same objection again.',
  'Leave out dates that have passed, unless they come back every year. Add nothing the facts do not say. No headings, no lists, no markup.'
].join('\n')

/** A fingerprint of the facts true now: it changes when one is learned, corrected or forgotten. */
export function basisOf(facts: readonly KnownFact[]): string {
  let hash = 0x811c9dc5
  for (const record of facts.map((fact) => fact.record).sort()) {
    for (let at = 0; at < record.length; at++) hash = Math.imul(hash ^ record.charCodeAt(at), 0x01000193)
  }
  return `${facts.length}-${(hash >>> 0).toString(16)}`
}

/** Ask the model for a profile. Rejects when the harness fails. */
export async function writeProfile(harness: Harness, facts: readonly KnownFact[], now: Date): Promise<string> {
  const listed = byImportance(facts)
    .slice(0, PROFILE_FACTS)
    .map((fact) => `- (${fact.kind}, learned ${fact.since.slice(0, 10)}) ${fact.text}`)
  const input = `Today is ${dayOf(now)}.\n\nThe facts:\n${listed.join('\n')}`
  return shorten(await harness.complete({ role: 'utility', instructions: PROFILE_INSTRUCTIONS, input }), PROFILE_LENGTH)
}

/**
 * The profile a session is given: the last one written, followed by the facts learned since, as they are.
 * With no profile yet, the facts themselves, the most important first. Nothing when nothing is known.
 */
export function profileFor(profile: { text: string; at: string } | undefined, facts: readonly KnownFact[]): string | undefined {
  const newer = byImportance(profile ? facts.filter((fact) => fact.at > profile.at) : facts).slice(0, LISTED_FACTS)
  const lines = newer.map((fact) => `- ${fact.text}`).join('\n')
  if (!profile) return lines === '' ? undefined : lines
  return lines === '' ? profile.text : `${profile.text}\n\nLearned since:\n${lines}`
}
