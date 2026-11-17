import { FACT_MAX_LENGTH } from '@repo/protocol'
import { z } from 'zod'
import type { Harness } from '../ports/harness.ts'
import { readJsonAnswer, shorten } from './answer.ts'
import type { Candidate } from './extract.ts'
import type { KnownFact } from './facts.ts'

/**
 * Each candidate fact against the known facts most like it: add, update, replace or ignore
 * (docs/SPEC.md, section 10.6). Without this, every sleep would repeat what the last one learned.
 */

/** A candidate with the known facts it may repeat or contradict. */
export interface Comparison {
  candidate: Candidate
  similar: readonly KnownFact[]
}

export type Decision =
  /** New: written as a fact of its own. */
  | { action: 'add'; candidate: Candidate; text: string }
  /** It completes a known fact, still true: a new version of that fact, with this text. */
  | { action: 'update'; candidate: Candidate; text: string; fact: KnownFact }
  /** A known fact is no longer true: a new fact that ends it. */
  | { action: 'replace'; candidate: Candidate; text: string; fact: KnownFact }
  /** Nothing a known fact does not say already. */
  | { action: 'ignore'; candidate: Candidate }

export const RECONCILE_INSTRUCTIONS = [
  "You keep a person's long-term memory tidy. You are given new candidate facts about them, each with the known facts most like it, if any.",
  '',
  'Decide for each candidate:',
  '- "add" when it is new information.',
  '- "update" when it completes or sharpens a known fact that is still true: give the merged text and the id of that fact.',
  '- "replace" when it shows a known fact is no longer true (they moved, changed jobs, changed their mind, a date moved): give the new text and the id of the fact it replaces.',
  '- "ignore" when a known fact already says it.',
  'Keep the wording short, in the language of the facts, calling the person "the user". Keep absolute dates as they are.',
  '',
  'Answer with JSON only, one decision per candidate, and nothing around it:',
  '{"decisions": [{"candidate": 1, "action": "add", "text": "..."}, {"candidate": 2, "action": "update", "fact": "k1", "text": "..."}, {"candidate": 3, "action": "ignore"}]}'
].join('\n')

const answerSchema = z.object({
  decisions: z.array(
    z.object({
      candidate: z.union([z.number(), z.string()]),
      action: z.enum(['add', 'update', 'replace', 'ignore']),
      fact: z.string().optional(),
      text: z.string().optional()
    })
  )
})

/** What the model reads. Known facts are labelled k1, k2… so their identifiers stay out of it. */
export function reconcileInput(comparisons: readonly Comparison[]): { input: string; labels: Map<string, KnownFact> } {
  const labels = new Map<string, KnownFact>()
  const labelOf = (fact: KnownFact) => {
    for (const [label, known] of labels) if (known.fact === fact.fact) return label
    const label = `k${labels.size + 1}`
    labels.set(label, fact)
    return label
  }
  const input = comparisons
    .map(({ candidate, similar }, index) => {
      const known = similar.length === 0 ? '  (no similar fact known)' : similar.map((fact) => `  ${labelOf(fact)}: ${fact.text}`).join('\n')
      return `Candidate ${index + 1} (${candidate.kind}): ${candidate.text}\nKnown facts like it:\n${known}`
    })
    .join('\n\n')
  return { input, labels }
}

/**
 * Decide what to do with each candidate. A candidate with no similar fact is added without asking, so a sleep
 * that learns only new things makes no call. Rejects when the harness fails, or with `UnreadableAnswer`.
 */
export async function reconcile(harness: Harness, comparisons: readonly Comparison[]): Promise<Decision[]> {
  if (comparisons.every(({ similar }) => similar.length === 0)) {
    return comparisons.map(({ candidate }) => ({ action: 'add', candidate, text: candidate.text }))
  }
  const { input, labels } = reconcileInput(comparisons)
  const answer = await harness.complete({ role: 'utility', instructions: RECONCILE_INSTRUCTIONS, input })
  const { decisions } = readJsonAnswer(answer, answerSchema, 'decisions')

  return comparisons.map(({ candidate, similar }, index): Decision => {
    const said = decisions.find((decision) => Number(decision.candidate) === index + 1)
    // A candidate the model passed over is kept: losing a fact is worse than holding it twice.
    if (!said) return { action: 'add', candidate, text: candidate.text }
    if (said.action === 'ignore') return { action: 'ignore', candidate }
    const text = shorten(said.text ?? candidate.text, FACT_MAX_LENGTH) || candidate.text
    if (said.action === 'add') return { action: 'add', candidate, text }
    // Only a fact the candidate was compared with can be changed by it.
    const fact = said.fact === undefined ? undefined : labels.get(said.fact)
    if (!fact || !similar.some((known) => known.fact === fact.fact)) return { action: 'add', candidate, text }
    return { action: said.action, candidate, text, fact }
  })
}
