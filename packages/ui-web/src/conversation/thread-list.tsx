import type { Exchange, Thread, Threads } from '@repo/protocol'
import { type ComponentProps, useMemo, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { SearchField } from '../primitives/search-field.tsx'
import { doingOf } from './plan.ts'

/** What a thread is, on its row and over its work: a topic, a side question asked beside one, or a sub-thread. */
export const kindWords = (thread: Thread): string => (thread.kind === 'subthread' ? 'Sub-thread' : thread.beside !== undefined ? 'Side question' : 'Topic')

/** The thread a thread is listed under: the one a sub-thread works for, or the topic a side question was asked beside. */
export const overOf = (thread: Thread): string | undefined => (thread.kind === 'subthread' ? thread.parent : thread.beside)

/** The threads listed under a thread, those at work first, then the most recently used. */
export function underOf(thread: string, threads: readonly Thread[]): Thread[] {
  const working = (one: Thread) => (one.state === 'working' ? 0 : 1)
  const at = (one: Thread) => new Date(one.at).getTime() || 0
  return threads.filter((one) => overOf(one) === thread).sort((one, other) => working(one) - working(other) || at(other) - at(one))
}

/** What the threads under a thread are called, together, over them. */
export function underWords(under: readonly Thread[]): string {
  const kinds = new Set(under.map(kindWords))
  if (kinds.size > 1) return 'Under this thread'
  return kinds.has('Sub-thread') ? (under.length === 1 ? 'Sub-thread' : 'Sub-threads') : under.length === 1 ? 'Side question' : 'Side questions'
}

/** What each state is called, after the kind. */
export const STATE = { working: 'working', ready: 'ready', parked: 'idle' } as const

/** A thread listed on its own row, with the side questions asked beside it and the sub-threads it handed work to under it. */
interface ThreadGroup {
  head: Thread
  under: Thread[]
}

/** The parts of the list, in order: what is at work, what has an answer waiting, and the rest. */
const SECTIONS = ['working', 'ready', 'earlier'] as const
type SectionName = (typeof SECTIONS)[number]
const SECTION_TITLE: Record<SectionName, string> = { working: 'At work', ready: 'Ready', earlier: 'Earlier' }

interface ThreadSection {
  name: SectionName
  groups: ThreadGroup[]
}

/** A text as it is compared with what is typed: without accents or case. */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Whether a thread is found by every word typed, in its title or its folder's name. */
const matches = (thread: Thread, words: readonly string[]) => {
  const text = plain(`${thread.title} ${thread.folder === undefined ? '' : lastPart(thread.folder)}`)
  return words.every((word) => text.includes(word))
}

/**
 * The threads as the side sheet lists them: each topic with the side questions asked while it was on the stage and
 * the sub-threads it opened under it, one level deep; one whose topic is gone, or is itself under another, stands on
 * its own row, so none is ever left out. A group is listed at work when any of its threads works, ready when any has
 * an answer waiting, else with the rest, and the groups used most recently come first. Words typed keep the threads whose title or folder holds them all, each
 * under its topic, and everything under a topic found.
 */
export function sectionThreads(threads: readonly Thread[], query = ''): ThreadSection[] {
  const words = plain(query).split(/\s+/).filter(Boolean)
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const isHead = (thread: Thread) => {
    const over = overOf(thread)
    const above = over === undefined ? undefined : byId.get(over)
    return above === undefined || overOf(above) !== undefined
  }
  const heads = threads.filter(isHead)
  const groups: ThreadGroup[] = []
  for (const head of heads) {
    const under = threads.filter((thread) => !isHead(thread) && overOf(thread) === head.id)
    if (words.length === 0 || matches(head, words)) groups.push({ head, under })
    else {
      const found = under.filter((thread) => matches(thread, words))
      if (found.length > 0) groups.push({ head, under: found })
    }
  }
  const latest = (group: ThreadGroup) => Math.max(...[group.head, ...group.under].map((thread) => new Date(thread.at).getTime() || 0))
  const sectionOf = (group: ThreadGroup): SectionName => {
    const states = [group.head, ...group.under].map((thread) => thread.state)
    return states.includes('working') ? 'working' : states.includes('ready') ? 'ready' : 'earlier'
  }
  const sorted = groups.map((group) => ({ group, at: latest(group) })).sort((one, other) => other.at - one.at)
  return SECTIONS.map((name) => ({ name, groups: sorted.filter(({ group }) => sectionOf(group) === name).map(({ group }) => group) })).filter(
    (section) => section.groups.length > 0
  )
}

/** When a thread was last used, as a list of mail says it: the time today, "Yesterday", or the day. */
export function usedWords(iso: string, now: Date, locale?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days <= 0) return at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** How many groups of the earlier threads show before the rest is asked for, and how many more it takes to fold them. */
const EARLIER_SHOWN = 20
const EARLIER_FOLDED = 5

interface ThreadListProps {
  threads: Threads
  /** The conversation's lines, to say what each thread at work is doing. */
  exchanges: readonly Exchange[]
  /** The thread opened last, marked in the list. */
  selected: string | undefined
  onOpen(thread: string): void
  onStop(thread: string): void
  onOpenProject(): void
}

/**
 * The threads behind the one conversation: what is at work first, saying what each is doing, then what has an
 * answer waiting, then the rest, each topic with its side questions and sub-threads under it. A field finds one by its
 * title or folder. Pressing one opens its work; one at work can be stopped from its row.
 */
export function ThreadList({ threads, exchanges, selected, onOpen, onStop, onOpenProject }: ThreadListProps) {
  const [query, setQuery] = useState('')
  const [allEarlier, setAllEarlier] = useState(false)
  const sections = useMemo(() => sectionThreads(threads.threads, query), [threads.threads, query])
  const now = new Date()
  const row = (thread: Thread, nested: boolean) => (
    <Row
      thread={thread}
      nested={nested}
      onScreen={threads.focus === thread.id}
      selected={selected === thread.id}
      doing={thread.state === 'working' ? doingOf(thread.id, exchanges) : undefined}
      used={usedWords(thread.at, now)}
      onOpen={onOpen}
      onStop={onStop}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        {threads.threads.length > 0 && (
          <SearchField value={query} onChange={setQuery} placeholder="Find a thread" label="Find a thread by its title or folder" />
        )}
        <Button kind="secondary" size="sm" className="ml-auto shrink-0" onClick={onOpenProject}>
          Open a project
        </Button>
      </div>
      {threads.threads.length === 0 ? (
        <p className="px-5 py-3 text-sm text-text-faint">Topics appear here as the conversation opens them, and projects as you open them.</p>
      ) : sections.length === 0 ? (
        <p className="px-5 py-3 text-sm text-text-faint [overflow-wrap:anywhere]">No thread is called “{query.trim()}”.</p>
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
          {sections.map((section) => {
            const folded = section.name === 'earlier' && !allEarlier && query === '' && section.groups.length > EARLIER_SHOWN + EARLIER_FOLDED
            const shown = folded ? section.groups.slice(0, EARLIER_SHOWN) : section.groups
            return (
              <section key={section.name} aria-label={SECTION_TITLE[section.name]} className="mt-3 grid gap-1 first:mt-0">
                <h3 className="flex items-baseline gap-1.5 px-3 pt-1">
                  <Eyebrow accent={section.name === 'working'}>{SECTION_TITLE[section.name]}</Eyebrow>
                  <span className="text-[0.6875rem] text-text-faint tabular-nums">{section.groups.length}</span>
                </h3>
                <ul className="grid gap-px">
                  {shown.map(({ head, under }) => (
                    <li key={head.id}>
                      {row(head, false)}
                      {under.length > 0 && (
                        <ul className="mb-1 ml-[1.375rem] grid gap-px border-line border-l pl-1.5">
                          {under.map((thread) => (
                            <li key={thread.id}>{row(thread, true)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                {folded && (
                  <Button kind="quiet" size="sm" className="mx-1 w-fit" onClick={() => setAllEarlier(true)}>
                    Show {section.groups.length - EARLIER_SHOWN} more
                  </Button>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  thread: Thread
  /** Under its topic: a side question or a sub-thread. */
  nested: boolean
  onScreen: boolean
  selected: boolean
  /** For a thread at work: where its plan stands, or what it is answering. */
  doing: string | undefined
  /** When it was last used, in words. */
  used: string
  onOpen(thread: string): void
  onStop(thread: string): void
}

function Row({ thread, nested, onScreen, selected, doing, used, onOpen, onStop }: RowProps) {
  const working = thread.state === 'working'
  // What a thread is said only where it is not the usual one: a topic.
  const kind = kindWords(thread)
  const meta = [
    kind === 'Topic' ? undefined : kind,
    thread.folder === undefined ? undefined : `in ${lastPart(thread.folder)}`,
    working ? (doing ?? 'working') : thread.state === 'ready' ? 'answer waiting' : undefined,
    onScreen ? 'on screen' : undefined
  ].filter((part) => part !== undefined)
  return (
    <div
      className={cn(
        'group flex items-center rounded-sm transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05]',
        selected && 'bg-white/[0.07]'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(thread.id)}
        aria-current={selected || undefined}
        title={doing === undefined ? thread.folder : doing}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm px-3 py-1.5 text-left outline-none focus-visible:bg-white/[0.07]"
      >
        <StateDot state={thread.state} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn('truncate', nested ? 'text-[0.8125rem] text-text-soft' : 'text-sm')}>{thread.title}</span>
          {meta.length > 0 && <span className={cn('truncate text-label', working ? 'text-text-soft' : 'text-text-faint')}>{meta.join(' · ')}</span>}
        </span>
        {!working && <span className="shrink-0 text-[0.6875rem] text-text-faint tabular-nums">{used}</span>}
      </button>
      {working && <StopThread title={thread.title} onClick={() => onStop(thread.id)} className="mr-1.5" />}
    </div>
  )
}

/** The way to stop one thread at work, beside it: quiet until pointed at, then in the danger colour. */
export function StopThread({ title, className, ...rest }: { title: string } & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={`Stop ${title}`}
      className={cn(
        'h-6 shrink-0 rounded-sm px-2 text-label text-text-soft outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-danger/15 hover:text-danger focus-visible:bg-danger/15 focus-visible:text-danger',
        className
      )}
      {...rest}
    >
      Stop
    </button>
  )
}

/** Where a thread stands, as a dot: pulsing while it works, the accent when its answer waits. */
export function StateDot({ state }: { state: Thread['state'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        state === 'working' && 'animate-pulse bg-accent',
        state === 'ready' && 'bg-accent',
        state === 'parked' && 'bg-text-faint/60'
      )}
    />
  )
}
