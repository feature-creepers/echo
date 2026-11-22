import type { Logged } from '@repo/client'
import type { Event, EventName } from '@repo/protocol'
import { stepSummary } from '../conversation/steps.ts'

/**
 * The groups the inspector sifts events by, as the person thinks of what happens: the conversation (turns, plans,
 * what is said and written), the work behind it (tool calls and the uses of the computer), what the screen shows,
 * and the rest, the state the core keeps.
 */
export const EVENT_GROUPS = ['all', 'conversation', 'work', 'screen', 'state'] as const
export type EventGroup = (typeof EVENT_GROUPS)[number]

export const GROUP_TITLE: Record<EventGroup, string> = { all: 'All', conversation: 'Conversation', work: 'Work', screen: 'Screen', state: 'State' }

/** Each event's group. Typed whole, so an event added to the protocol is given one here before it builds. */
const GROUP_OF: Record<EventName, Exclude<EventGroup, 'all'>> = {
  'turn.started': 'conversation',
  'turn.ended': 'conversation',
  'turn.planned': 'conversation',
  'answer.written': 'conversation',
  'speech.say': 'conversation',
  activity: 'work',
  'activity.used': 'work',
  'allowances.changed': 'work',
  'workspace.changed': 'work',
  'view.shown': 'screen',
  'view.cleared': 'screen',
  'media.control': 'screen',
  'library.changed': 'screen',
  'device.notify': 'screen',
  'device.desktop': 'screen',
  'device.camera': 'screen',
  'settings.changed': 'state',
  'engines.changed': 'state',
  'threads.changed': 'state',
  'topics.changed': 'state',
  'memory.changed': 'state',
  'assistant.state': 'state',
  'schedule.changed': 'state',
  'accounts.changed': 'state',
  'services.changed': 'state'
}

/** What an event says in a few words, after its name: empty when its name says it all. */
export function eventSummary(event: Event): string {
  switch (event.name) {
    case 'speech.say':
      return event.text
    case 'activity': {
      const summary = event.step ? stepSummary(event.step) : ''
      return `${event.tool} ${event.phase}${summary ? ` · ${summary}` : ''}`
    }
    case 'answer.written':
      return `${event.exchange.written?.length ?? 0} characters`
    case 'turn.planned':
      return `${event.exchange.plan?.length ?? 0} steps`
    case 'turn.started':
    case 'turn.ended':
      return `${event.exchange.outcome}${event.exchange.thread ? ` · thread ${event.exchange.thread.slice(0, 8)}` : ''}`
    case 'view.shown':
      return `${event.view.title}${event.view.widget ? ' · saved' : ''}`
    case 'topics.changed':
      return [...event.topics.map((one) => one.topic.title), ...event.gone.map(() => 'gone')].join(' · ')
    case 'library.changed':
      return `${event.library.widgets.length} saved`
    default:
      return ''
  }
}

/** A text as it is compared with what is typed: without accents or case. */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A topic as the events tell of it: what names it, the threads that work for it, and the turns it answered. */
export interface TopicTrace {
  topic: string
  threads: ReadonlySet<string>
  turns: ReadonlySet<string>
}

/** Whether an event is about a topic: it names the topic, one of its threads or one of its turns. */
export function concerns(event: Event, { topic, threads, turns }: TopicTrace): boolean {
  switch (event.name) {
    case 'turn.started':
    case 'turn.ended':
    case 'turn.planned':
    case 'answer.written':
      return turns.has(event.exchange.turn) || (event.exchange.thread !== undefined && threads.has(event.exchange.thread))
    case 'speech.say':
    case 'activity':
      return turns.has(event.turn)
    case 'view.shown':
      return (event.view.turn !== undefined && turns.has(event.view.turn)) || (event.view.thread !== undefined && threads.has(event.view.thread))
    case 'topics.changed':
      return event.gone.includes(topic) || event.topics.some((one) => one.topic.id === topic)
    default:
      return false
  }
}

/**
 * The events the inspector lists, newest first: those of the group chosen whose name or summary holds every word
 * typed, and, with a topic given, those about it.
 */
export function siftEvents(events: readonly Logged[], group: EventGroup, query: string, about?: TopicTrace): Logged[] {
  const words = plain(query).split(/\s+/).filter(Boolean)
  const kept: Logged[] = []
  for (let index = events.length - 1; index >= 0; index--) {
    const logged = events[index] as Logged
    if (group !== 'all' && GROUP_OF[logged.event.name] !== group) continue
    if (about && !concerns(logged.event, about)) continue
    if (words.length > 0) {
      const text = plain(`${logged.event.name} ${eventSummary(logged.event)}`)
      if (!words.every((word) => text.includes(word))) continue
    }
    kept.push(logged)
  }
  return kept
}

/** How many events arrived after the newest of those held: the log keeps only its latest, so this counts from their numbers. */
export function arrivedSince(events: readonly Logged[], held: readonly Logged[]): number {
  const newest = held.at(-1)
  if (newest === undefined) return events.length
  let count = 0
  for (let index = events.length - 1; index >= 0 && (events[index] as Logged).id > newest.id; index--) count += 1
  return count
}
