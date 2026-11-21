import type { Exchange, Thread, Threads } from '@repo/protocol'
import { type ComponentProps, useMemo, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { ChevronGlyph } from '../primitives/icons.tsx'
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

/**
 * The parts of the list, in order: what is at work, what has an answer waiting, what was used today, then this week,
 * and what was put away or left for a week, folded.
 */
const SECTIONS = ['working', 'ready', 'today', 'week', 'archived'] as const
type SectionName = (typeof SECTIONS)[number]
const SECTION_TITLE: Record<SectionName, string> = { working: 'At work', ready: 'Ready', today: 'Today', week: 'This week', archived: 'Archived' }

/** How long a thread is left before it folds under Archived by itself. */
const IDLE_ARCHIVES_MS = 7 * 86_400_000

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
 * an answer waiting, archived when the person put it away or it was left for a week, else by the day it was last
 * used, the groups used most recently first. Words typed keep the threads whose title or folder holds them all, each
 * under its topic, and everything under a topic found.
 */
export function sectionThreads(threads: readonly Thread[], query = '', now = new Date()): ThreadSection[] {
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
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const sectionOf = ({ group, at }: { group: ThreadGroup; at: number }): SectionName => {
    const states = [group.head, ...group.under].map((thread) => thread.state)
    if (states.includes('working')) return 'working'
    if (states.includes('ready')) return 'ready'
    if (group.head.archived || at < now.getTime() - IDLE_ARCHIVES_MS) return 'archived'
    return at >= today ? 'today' : 'week'
  }
  const sorted = groups.map((group) => ({ group, at: latest(group) })).sort((one, other) => other.at - one.at)
  return SECTIONS.map((name) => ({ name, groups: sorted.filter((one) => sectionOf(one) === name).map(({ group }) => group) })).filter(
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

/** How long ago, in as few characters as a row's corner has: "now", "4m", "2h", then the day. */
export function agoWords(iso: string, now: Date): string {
  const passed = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(passed)) return ''
  if (passed < 60_000) return 'now'
  if (passed < 3_600_000) return `${Math.floor(passed / 60_000)}m`
  if (passed < 86_400_000) return `${Math.floor(passed / 3_600_000)}h`
  return usedWords(iso, now)
}

interface ThreadListProps {
  threads: Threads
  /** The conversation's lines, to say what each thread at work is doing. */
  exchanges: readonly Exchange[]
  /** The thread opened last, marked in the list. */
  selected: string | undefined
  onOpen(thread: string): void
  onStop(thread: string): void
  /** Put a thread away, or bring it back. */
  onArchive(thread: string, archived: boolean): void
  onOpenProject(): void
}

/**
 * The threads behind the one conversation, by where they stand: at work, saying what each is doing, then ready, then
 * used today and this week, and last what was put away or left for a week, folded. Each part is a list under its name,
 * opened by a rule of the ink, its rows parted by hairlines: a square that says how the thread stands, its title and
 * when it was used, then where it works and what it does. Each topic carries its side questions and sub-threads under
 * it, folded unless one of them works. A field finds one by its title or folder. Pressing one opens its work; pointing
 * at one offers to stop it while it works, else to archive or restore it.
 */
export function ThreadList({ threads, exchanges, selected, onOpen, onStop, onArchive, onOpenProject }: ThreadListProps) {
  const [query, setQuery] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const now = new Date()
  const sections = useMemo(() => sectionThreads(threads.threads, query), [threads.threads, query])
  const finding = query.trim() !== ''
  const row = (thread: Thread, nested: boolean, setAside: boolean) => (
    <Row
      thread={thread}
      nested={nested}
      setAside={setAside}
      onScreen={threads.focus === thread.id}
      selected={selected === thread.id}
      doing={thread.state === 'working' ? doingOf(thread.id, exchanges) : undefined}
      ago={agoWords(thread.at, now)}
      onOpen={onOpen}
      onStop={onStop}
      onArchive={onArchive}
    />
  )
  const toggle = (head: string) => setOpened((before) => new Set(before.has(head) ? [...before].filter((one) => one !== head) : [...before, head]))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        {threads.threads.length > 0 && (
          <SearchField value={query} onChange={setQuery} placeholder="Find a thread" label="Find a thread by its title or folder" />
        )}
        <Button kind="quiet" size="sm" className="ml-auto shrink-0" onClick={onOpenProject}>
          Open a project
        </Button>
      </div>
      {threads.threads.length === 0 ? (
        <Empty title="No threads yet" text="Topics appear here as the conversation opens them, and projects as you open them." />
      ) : sections.length === 0 ? (
        <Empty title="Nothing found" text={`No thread is called “${query.trim()}”.`} />
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]">
          {sections.map((section) => {
            const folded = section.name === 'archived' && !archivedOpen && !finding
            const setAside = section.name === 'archived'
            const heading = (
              <>
                <span>{SECTION_TITLE[section.name]}</span>
                <span className="ml-auto tabular-nums">{section.groups.length}</span>
              </>
            )
            return (
              <section key={section.name} aria-label={SECTION_TITLE[section.name]} className="mt-4 grid first:mt-2">
                {setAside ? (
                  <button
                    type="button"
                    aria-expanded={!folded}
                    onClick={() => setArchivedOpen(!archivedOpen)}
                    className="caps flex h-6 w-full items-center gap-1.5 text-left text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
                  >
                    <Fold open={!folded} />
                    {heading}
                  </button>
                ) : (
                  <h3 className="caps flex h-6 items-center gap-1.5 text-text-soft">{heading}</h3>
                )}
                {!folded && (
                  <ul className="grid border-text border-t-2">
                    {section.groups.map(({ head, under }) => {
                      // What is under a topic stays folded unless part of it works, the person opened it, or they are finding.
                      const open = finding || opened.has(head.id) || under.some((thread) => thread.state === 'working')
                      return (
                        <li key={head.id} className="border-line border-t first:border-t-0">
                          {row(head, false, setAside)}
                          {under.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => toggle(head.id)}
                              className="caps mb-1 ml-2 flex h-6 items-center gap-1.5 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
                            >
                              <Fold open={open} />
                              {`${under.length} ${underWords(under)}`}
                            </button>
                          )}
                          {under.length > 0 && open && (
                            <ul className="mb-2 ml-3.5 grid border-line border-l pl-2">
                              {under.map((thread) => (
                                <li key={thread.id} className="border-line border-t first:border-t-0">
                                  {row(thread, true, setAside)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The chevron of what folds: down while open, turned to the right while folded. */
function Fold({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className={cn('transition-transform duration-(--duration-quick) ease-soft [&_svg]:size-3', !open && '-rotate-90')}>
      <ChevronGlyph />
    </span>
  )
}

/** What a tab shows when it has nothing to list: a title and a sentence, centred in its room. */
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 pb-16 text-center">
      <p className="display text-[1.75rem] text-text leading-[1.5rem]">{title}</p>
      <p className="max-w-64 text-balance text-[0.8125rem] text-text-soft leading-relaxed">{text}</p>
    </div>
  )
}

interface RowProps {
  thread: Thread
  /** Under its topic: a side question or a sub-thread. */
  nested: boolean
  /** Put away, or left for a week: listed under Archived. */
  setAside: boolean
  onScreen: boolean
  selected: boolean
  /** For a thread at work: where its plan stands, or what it is answering. */
  doing: string | undefined
  /** How long ago it was last used, or since when it works, in a few characters. */
  ago: string
  onOpen(thread: string): void
  onStop(thread: string): void
  onArchive(thread: string, archived: boolean): void
}

function Row({ thread, nested, setAside, onScreen, selected, doing, ago, onOpen, onStop, onArchive }: RowProps) {
  const working = thread.state === 'working'
  const kind = kindWords(thread)
  // Where it works, else what it is when that is not the usual: a topic says nothing.
  const where = thread.folder === undefined ? (kind === 'Topic' ? undefined : kind) : lastPart(thread.folder)
  const line = [where, working ? (doing ?? 'Working') : onScreen ? 'On screen' : undefined].filter((part) => part !== undefined).join(' · ')
  return (
    <div
      className={cn(
        'group relative transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06]',
        selected && 'bg-text/[0.06] shadow-[inset_2px_0_0_var(--color-text)]'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(thread.id)}
        aria-current={selected || undefined}
        title={doing ?? thread.folder}
        className="-outline-offset-1 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 py-1.5 pr-1.5 pl-2.5 text-left"
      >
        <StateDot state={thread.state} archived={setAside} />
        <span className={cn('truncate text-[0.8125rem] leading-5', selected || !nested ? 'text-text' : 'text-text-soft')}>{thread.title}</span>
        {/* How it stands, at the row's end: since when it works, ready, or when it was last used. Pointed at, what can be
            done with it takes its place. */}
        <span className={cn('caps shrink-0 tabular-nums group-focus-within:invisible group-hover:invisible', working ? 'text-accent' : 'text-text-soft')}>
          {thread.state === 'ready' ? 'Ready' : ago}
        </span>
        {line !== '' && <span className="col-start-2 col-end-4 truncate text-[0.75rem] text-text-soft leading-4">{line}</span>}
      </button>
      <span className="absolute top-1 right-1 hidden items-center group-focus-within:flex group-hover:flex">
        {working ? (
          <StopThread title={thread.title} onClick={() => onStop(thread.id)} />
        ) : (
          !nested && (
            <button
              type="button"
              aria-label={`${thread.archived ? 'Restore' : 'Archive'} ${thread.title}`}
              onClick={() => onArchive(thread.id, !thread.archived)}
              className="caps flex h-6 items-center px-1.5 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
            >
              {thread.archived ? 'Restore' : 'Archive'}
            </button>
          )
        )}
      </span>
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
        'caps h-6 shrink-0 px-2 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:bg-danger/15 hover:text-danger focus-visible:bg-danger/15 focus-visible:text-danger',
        className
      )}
      {...rest}
    >
      Stop
    </button>
  )
}

/**
 * Where a thread stands, as a small square: the accent, its opacity pulsing, while it works; the ink when its answer
 * waits; a square drawn as a line while it rests; hatched once it is set aside.
 */
export function StateDot({ state, archived = false }: { state: Thread['state']; archived?: boolean | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0',
        state === 'working' && 'animate-pulse bg-accent',
        state === 'ready' && 'bg-text',
        state === 'parked' && (archived ? 'hatch text-text-soft' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]')
      )}
    />
  )
}
