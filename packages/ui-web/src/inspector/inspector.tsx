import type { Client, Logged } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { Empty } from '../conversation/thread-list.tsx'
import { useCopy } from '../conversation/use-copy.ts'
import { Button } from '../primitives/button.tsx'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { PauseGlyph, PlayGlyph } from '../primitives/icons.tsx'
import { SearchField } from '../primitives/search-field.tsx'
import { settle } from '../styles/motion.ts'
import { arrivedSince, EVENT_GROUPS, type EventGroup, eventSummary, GROUP_TITLE, siftEvents, type TopicTrace } from './sift.ts'

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })

/**
 * The raw events from the core, newest first, for those who want to see everything. They can be sifted by what
 * they are about and found by their words, and held still to be read: opening one holds the log, so what is read
 * does not move as others arrive, and a line at the top says how many came since and lets them in.
 */
/**
 * Where an event leads beyond the raw log: a change of memory opens the Memory page, where facts are edited and
 * forgotten (docs/SPEC.md, section 13.3).
 */
interface InspectorProps {
  client: Client
  /** The topic whose events alone are listed. Left out, every event. */
  about?: TopicTrace | undefined
  onOpenMemory?: (() => void) | undefined
}

export function Inspector({ client, about, onOpenMemory }: InspectorProps) {
  // Followed here rather than by the sheet, so the events that keep arriving draw only the tab that shows them.
  const events = useFollowed(client.events)
  const [group, setGroup] = useState<EventGroup>('all')
  const [query, setQuery] = useState('')
  const [held, setHeld] = useState<readonly Logged[]>()
  const [open, setOpen] = useState<number>()
  const list = useRef<HTMLOListElement>(null)

  const shown = useMemo(() => siftEvents(held ?? events, group, query, about), [held, events, group, query, about])
  const arrived = held === undefined ? 0 : arrivedSince(events, held)
  const hold = () => setHeld((was) => was ?? events)
  const follow = () => {
    setHeld(undefined)
    list.current?.scrollTo({ top: 0 })
  }

  if (events.length === 0)
    return <Empty title="No events yet" text="What the core tells the window appears here as it happens: turns, threads, views, memory and settings." />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2 px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Find an event" label="Find an event by its name or its words" />
          <IconButton label={held ? 'Follow new events' : 'Hold the log still'} active={held !== undefined} onClick={held ? follow : hold}>
            {held ? <PlayGlyph /> : <PauseGlyph />}
          </IconButton>
        </div>
        <Choice<EventGroup>
          label="Which events"
          value={group}
          options={EVENT_GROUPS.map((value) => ({ value, label: GROUP_TITLE[value] }))}
          onChange={setGroup}
        />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence>
          {held && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={settle}
              className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
            >
              <button
                type="button"
                onClick={follow}
                className="caps material shadow-float pointer-events-auto flex items-center gap-1.5 py-1 pr-2.5 pl-2 text-text-soft transition-colors hover:text-text"
              >
                <span className="size-2 bg-accent" />
                {arrived === 0 ? 'Held · follow new events' : arrived === 1 ? 'One new event · show' : `${arrived} new events · show`}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {shown.length === 0 ? (
          <p className="px-4 py-4 text-[0.8125rem] text-text-soft [overflow-wrap:anywhere]">
            {query.trim() !== ''
              ? `No event holds “${query.trim()}”.`
              : about
                ? 'No event about this topic since the window opened.'
                : `No ${GROUP_TITLE[group].toLowerCase()} event yet.`}
          </p>
        ) : (
          // Each line is keyed by its place in the order of arrival, so a line read stays where it is as others come in.
          <ol
            ref={list}
            className={cn(
              'scroll-quiet mx-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-text border-t-2 pb-2 font-mono text-[0.6875rem]',
              held && 'pt-9'
            )}
          >
            {shown.map((logged) => (
              <EventLine
                key={logged.id}
                logged={logged}
                open={open === logged.id}
                onToggle={() => {
                  if (open === logged.id) setOpen(undefined)
                  else {
                    setOpen(logged.id)
                    hold()
                  }
                }}
                onOpenMemory={onOpenMemory}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function EventLine({ logged, open, onToggle, onOpenMemory }: { logged: Logged; open: boolean; onToggle(): void; onOpenMemory?: (() => void) | undefined }) {
  const { event } = logged
  const summary = eventSummary(event)
  return (
    <li className="border-line border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          '-outline-offset-1 flex w-full items-baseline gap-2 px-1 py-1 text-left transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06]',
          open && 'bg-text/[0.06] shadow-[inset_2px_0_0_var(--color-text)]'
        )}
      >
        <span className="shrink-0 text-text-faint tabular-nums">{time.format(logged.at)}</span>
        <span className="shrink-0 text-text">{event.name}</span>
        <span className="min-w-0 truncate text-text-soft">{summary}</span>
      </button>
      {open && event.name === 'memory.changed' && onOpenMemory && (
        <Button kind="quiet" size="sm" onClick={onOpenMemory} className="mb-1 ml-1 w-fit">
          Edit or forget in Memory
        </Button>
      )}
      {open && <EventWhole logged={logged} />}
    </li>
  )
}

/** An event opened: all it holds, wrapped rather than scrolled sideways, and a way to copy it. */
function EventWhole({ logged }: { logged: Logged }) {
  const text = useMemo(() => JSON.stringify(logged.event, null, 2), [logged])
  const { copied, copy } = useCopy(text)
  return (
    <div className="relative mb-2">
      <Button kind="quiet" size="sm" onClick={copy} aria-live="polite" className="absolute top-1.5 right-1.5">
        {copied === undefined ? 'Copy' : copied ? 'Copied' : 'Could not copy'}
      </Button>
      {/* An event can hold a long answer, an address or a path. */}
      <pre className="scroll-quiet max-h-96 overflow-y-auto whitespace-pre-wrap border border-line bg-surface p-3 pr-16 text-text-soft leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  )
}
