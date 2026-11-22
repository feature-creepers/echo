import { type Answer, inProgress, type Thread, type Topic, type TopicAnswers, type TopicProgress } from '@repo/protocol'

/** What each standing of a topic in progress is called. */
export const PROGRESS_WORDS: Record<TopicProgress, string> = { asks: 'Asks you', working: 'At work', ready: 'Ready', quiet: 'Quiet' }

/** What needs the person comes first. */
const RANK: Record<TopicProgress, number> = { asks: 0, working: 1, ready: 2, quiet: 3 }

/**
 * The topics in progress at a moment, in the order the Now zone shows them (docs/SPEC.md, section 13.2): what needs
 * the person first (it asks them something, it is at work, an answer waits), then the one last active.
 */
export function topicsNow(topics: readonly TopicAnswers[], moment: Date): TopicAnswers[] {
  const rank = (topic: Topic) => RANK[topic.progress ?? 'quiet']
  return topics
    .filter((one) => inProgress(one.topic, moment))
    .sort((one, other) => rank(one.topic) - rank(other.topic) || other.topic.at.localeCompare(one.topic.at))
}

/** The first title of an answer written in Markdown, without its marks: what the answer names as its outcome. */
export const headingOf = (written: string | undefined): string | undefined => written?.match(/^#{1,6}[ \t]+(.+)$/m)?.[1]?.replace(/\*\*|`/g, '')

/**
 * What a topic's latest answer found, on one line: the title of the answer it wrote, which names the outcome, else
 * what it said, else what was asked while nothing is said yet.
 */
export function latestLine(answer: Answer | undefined): string | undefined {
  const line = answer?.exchange
  const words = (headingOf(line?.written) ?? (line?.replied.trim() ? line.replied : line?.said) ?? '').replace(/\s+/g, ' ').trim()
  return words === '' ? undefined : words
}

/** How many topics the hub holds on each side of the eye. */
export const HUB_SIDE = 4

/** Which topics stand on the hub's spokes, by their place among those in progress, and how many wait on other turns of it. */
interface HubTurn {
  left: number[]
  right: number[]
  /** How many topics are not on this turn of the hub: its last spoke then turns it. */
  more: number
}

/**
 * The spokes of the hub for a number of topics (docs/SPEC.md, section 13.2). Up to eight stand on it together, half on
 * each side. More than that, seven stand on it at a time and the last spoke turns it to the next seven.
 */
export function hubTurn(count: number, turn: number): HubTurn {
  const places = Array.from({ length: count }, (_, at) => at)
  if (count <= 2 * HUB_SIDE) {
    const half = Math.ceil(count / 2)
    return { left: places.slice(0, half), right: places.slice(half), more: 0 }
  }
  const shown = 2 * HUB_SIDE - 1
  const turns = Math.ceil(count / shown)
  const from = (((turn % turns) + turns) % turns) * shown
  const here = places.slice(from, from + shown)
  return { left: here.slice(0, HUB_SIDE), right: here.slice(HUB_SIDE), more: count - here.length }
}

/** The topic a thread works for, as the core files its answers: a sub-thread's is its thread's. */
export function topicOf(thread: Thread | undefined, threads: readonly Thread[]): string | undefined {
  if (!thread) return undefined
  if (thread.kind !== 'subthread') return thread.topic ?? thread.id
  return topicOf(
    threads.find((one) => one.id === thread.parent),
    threads
  )
}
