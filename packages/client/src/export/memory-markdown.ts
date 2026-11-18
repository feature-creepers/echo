import type { Fact, FactKind, MemoryView } from '@repo/protocol'

/** What each kind of fact is called, as a heading for the user. */
export const FACT_KIND_TITLES: Record<FactKind, string> = {
  person: 'People',
  preference: 'Preferences',
  project: 'Projects',
  date: 'Dates',
  override: 'Decisions you kept',
  other: 'Other'
}

/** The day of a date, as YYYY-MM-DD. */
const day = (iso: string) => iso.slice(0, 10)

/** A line of text kept on one line of Markdown, with nothing in it read as markup. */
const inline = (text: string) => text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')

function line(fact: Fact): string {
  const source = fact.sources.find((candidate) => candidate.said !== undefined)
  const where = source?.said === undefined ? '' : `, from “${inline(source.said)}”`
  return `- ${inline(fact.text)} _(learned ${day(fact.since)}${where})_`
}

/**
 * Everything the assistant knows about the user, as a Markdown file they can read and correct: the profile,
 * then the facts by kind, each with when and where it was learned (docs/SPEC.md, section 10.7).
 */
export function memoryMarkdown(memory: MemoryView, { title, now }: { title: string; now: Date }): string {
  const parts = [`# ${inline(title)}`, `Exported on ${day(now.toISOString())}.`]
  if (memory.profile) parts.push(`## Profile\n\n${memory.profile.trim()}`)
  for (const group of memory.groups) parts.push(`## ${FACT_KIND_TITLES[group.kind]}\n\n${group.facts.map(line).join('\n')}`)
  if (memory.groups.length === 0) parts.push('Nothing is known yet.')
  return `${parts.join('\n\n')}\n`
}
