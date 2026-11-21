import type { Exchange, Thread, Threads } from '@repo/protocol'
import { type ComponentProps, useMemo, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
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
 * used today and this week, and last what was put away or left for a week, folded. Each row is a small card: where
 * the thread works and how it stands, its title, then what it does. Each topic carries its side questions and
 * sub-threads under it, folded unless one of them works. A field finds one by its title or folder. Pressing one opens
 * its work; pointing at one offers to stop it while it works, else to archive or restore it.
 */
export function ThreadList({ threads, exchanges, selected, onOpen, onStop, onArchive, onOpenProject }: ThreadListProps) {
  const [query, setQuery] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const now = new Date()
  const sections = useMemo(() => sectionThreads(threads.threads, query), [threads.threads, query])
  const finding = query.trim() !== ''
  const row = (thread: Thread, nested: boolean) => (
    <Row
      thread={thread}
      nested={nested}
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
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
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
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]">
          {sections.map((section) => {
            const folded = section.name === 'archived' && !archivedOpen && !finding
            const heading = (
              <>
                <span className={section.name === 'working' ? 'text-accent' : undefined}>{SECTION_TITLE[section.name]}</span>
                <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-line" />
                <span className="font-normal tabular-nums">{section.groups.length}</span>
              </>
            )
            return (
              <section key={section.name} aria-label={SECTION_TITLE[section.name]} className="mt-2 grid gap-px first:mt-1">
                {section.name === 'archived' ? (
                  <button
                    type="button"
                    aria-expanded={!folded}
                    onClick={() => setArchivedOpen(!archivedOpen)}
                    className="flex h-7 w-full items-center gap-2 px-2.5 text-left font-medium text-[0.6875rem] text-text-faint outline-none hover:text-text-soft focus-visible:text-text-soft"
                  >
                    {heading}
                    <span
                      aria-hidden="true"
                      className={cn('text-[0.625rem] transition-transform duration-(--duration-quick) ease-soft', folded && '-rotate-90')}
                    >
                      ▾
                    </span>
                  </button>
                ) : (
                  <h3 className="flex h-7 items-center gap-2 px-2.5 font-medium text-[0.6875rem] text-text-faint">{heading}</h3>
                )}
                {!folded && (
                  <ul className="grid gap-px">
                    {section.groups.map(({ head, under }) => {
                      // What is under a topic stays folded unless part of it works, the person opened it, or they are finding.
                      const open = finding || opened.has(head.id) || under.some((thread) => thread.state === 'working')
                      return (
                        <li key={head.id}>
                          {row(head, false)}
                          {under.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => toggle(head.id)}
                              className="ml-2.5 flex h-6 items-center gap-1.5 px-2 text-[0.6875rem] text-text-faint outline-none hover:text-text-soft focus-visible:text-text-soft"
                            >
                              <span
                                aria-hidden="true"
                                className={cn('text-[0.625rem] transition-transform duration-(--duration-quick) ease-soft', !open && '-rotate-90')}
                              >
                                ▾
                              </span>
                              {`${under.length} ${underWords(under).toLowerCase()}`}
                            </button>
                          )}
                          {under.length > 0 && open && (
                            <ul className="mb-1 ml-3.5 grid gap-px border-line border-l pl-1.5">
                              {under.map((thread) => (
                                <li key={thread.id}>{row(thread, true)}</li>
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

/** What a tab shows when it has nothing to list: a title and a sentence, centred in its room. */
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-8 pb-16 text-center">
      <p className="font-medium text-sm text-text">{title}</p>
      <p className="max-w-64 text-balance text-text-faint text-xs leading-relaxed">{text}</p>
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
  /** How long ago it was last used, or since when it works, in a few characters. */
  ago: string
  onOpen(thread: string): void
  onStop(thread: string): void
  onArchive(thread: string, archived: boolean): void
}

function Row({ thread, nested, onScreen, selected, doing, ago, onOpen, onStop, onArchive }: RowProps) {
  const working = thread.state === 'working'
  const kind = kindWords(thread)
  // Where it works, else what it is when that is not the usual: a topic says nothing.
  const where = thread.folder === undefined ? (kind === 'Topic' ? undefined : kind) : lastPart(thread.folder)
  const line = working ? (doing ?? 'Working') : onScreen ? 'On screen' : undefined
  // How it stands, in the row's corner: at work and since when, ready, or when it was last used.
  const state = (
    <span className="flex shrink-0 items-center gap-1 tabular-nums group-focus-within:invisible group-hover:invisible">
      {working ? (
        <span className="flex items-center gap-1 text-accent">
          <StateDot state="working" />
          {`Working ${ago === 'now' ? '' : ago}`.trim()}
        </span>
      ) : thread.state === 'ready' ? (
        <span className="flex items-center gap-1 text-accent">
          <StateDot state="ready" />
          Ready
        </span>
      ) : (
        ago
      )}
    </span>
  )
  return (
    <div
      className={cn(
        'group relative transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.05]',
        selected && 'bg-text/[0.07] hover:bg-text/[0.07]'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(thread.id)}
        aria-current={selected || undefined}
        title={doing ?? thread.folder}
        className="grid w-full min-w-0 px-2.5 py-1.5 text-left outline-none focus-visible:bg-text/[0.07]"
      >
        {where !== undefined && (
          <span className="flex h-4 min-w-0 items-center gap-1.5 text-[0.6875rem] text-text-faint">
            <span className="min-w-0 flex-1 truncate">{where}</span>
            {state}
          </span>
        )}
        <span className={cn('flex min-w-0 items-center gap-1.5', where !== undefined && 'mt-0.5')}>
          <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem] leading-5', nested ? 'text-text-soft' : 'font-medium text-text')}>{thread.title}</span>
          {where === undefined && <span className="text-[0.6875rem] text-text-faint">{state}</span>}
        </span>
        {line && <span className={cn('truncate text-[0.6875rem] leading-4', working ? 'text-text-soft' : 'text-text-faint')}>{line}</span>}
      </button>
      {/* Pointed at, its corner offers what can be done with it, where its state was. */}
      <span className="absolute top-1 right-1.5 hidden items-center group-focus-within:flex group-hover:flex">
        {working ? (
          <StopThread title={thread.title} onClick={() => onStop(thread.id)} className="h-5" />
        ) : (
          !nested && (
            <button
              type="button"
              aria-label={`${thread.archived ? 'Restore' : 'Archive'} ${thread.title}`}
              onClick={() => onArchive(thread.id, !thread.archived)}
              className="flex h-5 items-center px-1.5 text-[0.6875rem] text-text-faint outline-none transition-colors duration-(--duration-quick) ease-soft hover:text-text focus-visible:text-text"
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
        'h-6 shrink-0 px-2 text-label text-text-soft outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-danger/15 hover:text-danger focus-visible:bg-danger/15 focus-visible:text-danger',
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
        'size-1.5 shrink-0',
        state === 'working' && 'animate-pulse bg-accent',
        state === 'ready' && 'bg-accent',
        state === 'parked' && 'bg-text-faint/60'
      )}
    />
  )
}
