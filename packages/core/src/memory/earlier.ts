import { FACT_MAX_LENGTH, type FactKind } from '@repo/protocol'
import { z } from 'zod'
import { inFolder } from '../projects/folders.ts'
import { shorten } from './answer.ts'

/**
 * What the proof of concept knew, brought in once (docs/SPEC.md, section 10.7). It kept, in its data folder (in the
 * home folder, named after it): its notes about the user, a list of short lines a model rewrote after each conversation
 * (`workspace/memory.md`); the user's context file, a template they filled in (`workspace/CLAUDE.md`); and its
 * history, one file a day of what was said and answered (`history/2026-03-01.jsonl`). The notes and the context
 * become facts; the history becomes lines of earlier conversations, dated when they were said, found by search and
 * recall as the log is, and never made sense of by sleep, since the notes already hold what mattered.
 */

/** The type of a line of a conversation held before this app, brought in with the date it was said. */
export const EARLIER_LINE = 'memory.earlier-line'

/** The type of the record that says an import was done: from where, and how much it brought in. */
export const IMPORTED = 'memory.imported'

/** Where the proof of concept kept each of its files, in its data folder. */
export const EARLIER_FILES = {
  notes: (folder: string) => inFolder(inFolder(folder, 'workspace'), 'memory.md'),
  context: (folder: string) => inFolder(inFolder(folder, 'workspace'), 'CLAUDE.md'),
  history: (folder: string) => inFolder(folder, 'history')
}

/** A day of its history: the file's name. */
export const HISTORY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

/** A fact found in its files, before it is kept. */
export interface EarlierFact {
  text: string
  kind: FactKind
}

/** A line of its history: when, what the user said and what it answered. */
export interface EarlierLine {
  at: string
  said: string
  replied: string
}

export const earlierLineSchema = z.object({ said: z.string(), replied: z.string() })
export const importedSchema = z.object({ from: z.string(), facts: z.number().int().nonnegative(), lines: z.number().int().nonnegative() })

/** A line of a list, without its mark: "- ", "* " or "• ". Nothing for a line that is not an item. */
const item = (line: string): string | undefined => line.match(/^\s*[-*•]\s+(.+?)\s*$/)?.[1]

/** The notes: each item a fact, as the proof of concept wrote it. */
export function notesOf(text: string): EarlierFact[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const fact = item(line)
    return fact ? [{ text: shorten(fact, FACT_MAX_LENGTH), kind: 'other' as const }] : []
  })
}

/** The template's sections, by their heading folded, and the kind of what each says. */
const SECTION_KINDS: Record<string, FactKind> = { 'who i am': 'person', 'what i do': 'project', 'how i work': 'preference' }

/**
 * The context file: each item the person wrote a fact, of the kind its section says ("Who I am": about the person),
 * and nothing of what the template held: an item left as its placeholder, "(your name…)", whole or after its label.
 */
export function contextOf(text: string): EarlierFact[] {
  let kind: FactKind = 'other'
  const found: EarlierFact[] = []
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/)?.[1]
    if (heading !== undefined) {
      kind = SECTION_KINDS[heading.toLowerCase()] ?? 'other'
      continue
    }
    const fact = item(line)
    if (!fact) continue
    const value = fact.includes(':') ? fact.slice(fact.indexOf(':') + 1).trim() : fact
    if (value === '' || /^\(.*\)$/.test(value)) continue
    found.push({ text: shorten(fact, FACT_MAX_LENGTH), kind })
  }
  return found
}

const historyLine = z.object({ t: z.string(), user: z.string().default(''), reply: z.string().default('') })

/** A day of the history: each line that says when it was and has words, in the order they were said. */
export function historyOf(text: string): EarlierLine[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === '') return []
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return []
    }
    const read = historyLine.safeParse(parsed)
    if (!read.success) return []
    const at = new Date(read.data.t)
    const said = read.data.user.trim()
    const replied = read.data.reply.trim()
    if (Number.isNaN(at.getTime()) || (said === '' && replied === '')) return []
    return [{ at: at.toISOString(), said, replied }]
  })
}
