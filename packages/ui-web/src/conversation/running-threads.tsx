import type { Exchange, Thread } from '@repo/protocol'
import { useId, useRef, useState } from 'react'
import { BAR_LABEL } from '../access/access-indicator.tsx'
import { lastPart } from '../changes/words.ts'
import { ArrowGlyph } from '../primitives/icons.tsx'
import { Floating } from '../primitives/menu.tsx'
import { answeringOf, doingOf } from './plan.ts'
import { kindWords, overOf, StateDot } from './thread-list.tsx'

/** A thread at work as the list under the composer shows it: under the thread at work it does part of, if any. */
interface WorkingRow {
  thread: Thread
  nested: boolean
  /** For a thread listed under a topic that is not at work, that topic's title, which says what it is part of. */
  partOf: string | undefined
}

/**
 * The threads at work in the order the list shows them: the most recent first, each with its own at work under it;
 * a sub-thread or a side question whose topic rests stands on a row of its own, saying what it is part of.
 */
export function workingRows(threads: readonly Thread[]): WorkingRow[] {
  const working = threads.filter((thread) => thread.state === 'working')
  const atWork = new Set(working.map((thread) => thread.id))
  const rows: WorkingRow[] = []
  for (const thread of working) {
    const over = overOf(thread)
    if (over !== undefined && atWork.has(over)) continue
    const above = over === undefined ? undefined : threads.find((one) => one.id === over)
    rows.push({ thread, nested: false, partOf: above?.title })
    for (const under of working) if (overOf(under) === thread.id) rows.push({ thread: under, nested: true, partOf: undefined })
  }
  return rows
}

/**
 * The threads at work, under the composer: a few words saying how many, which open the list of them. Pressing one
 * opens its work in the side sheet; each can be stopped on its own while the others go on, and the last row opens
 * every thread there.
 */
export function RunningThreads({
  threads,
  exchanges,
  onOpen,
  onStop
}: {
  threads: readonly Thread[]
  exchanges: readonly Exchange[]
  /** Open a thread's work in the side sheet, or with none, the list of threads. */
  onOpen(thread: string | undefined): void
  onStop(thread: string): void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  const rows = workingRows(threads)
  const working = rows.length
  if (working === 0) return null

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={BAR_LABEL}
      >
        <StateDot state="working" />
        {working === 1 ? '1 at work' : `${working} at work`}
      </button>
      <Floating
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        side="top"
        align="start"
        role="dialog"
        id={id}
        label="Work under way"
        className="w-[22rem]"
      >
        <ul className="scroll-quiet grid max-h-[min(28rem,60vh)] gap-px overflow-y-auto p-1">
          {rows.map(({ thread, nested, partOf }) => {
            const answering = answeringOf(thread.id, exchanges)
            const doing = doingOf(thread.id, exchanges)
            const where = [
              nested ? kindWords(thread) : partOf === undefined ? undefined : `${kindWords(thread)} of ${partOf}`,
              thread.folder === undefined ? undefined : `in ${lastPart(thread.folder)}`,
              doing ?? 'working'
            ].filter((part) => part !== undefined)
            return (
              <li key={thread.id} className={nested ? 'ml-[1.125rem] border-line border-l pl-1' : undefined}>
                <div className="flex items-center gap-1 rounded-sm hover:bg-white/[0.05]">
                  <button
                    type="button"
                    data-entry={thread.title}
                    onClick={() => {
                      onOpen(thread.id)
                      setOpen(false)
                    }}
                    title={answering ?? 'Show its work'}
                    className="grid min-w-0 flex-1 gap-0.5 rounded-sm px-2.5 py-1.5 text-left outline-none focus-visible:bg-white/[0.07]"
                  >
                    <span className={nested ? 'truncate text-[0.75rem] text-text-soft' : 'truncate text-[0.8125rem] text-text'}>{thread.title}</span>
                    <span className="truncate text-label text-text-faint">{where.join(' · ')}</span>
                  </button>
                  <button
                    type="button"
                    data-entry={`Stop ${thread.title}`}
                    onClick={() => onStop(thread.id)}
                    aria-label={`Stop ${thread.title}`}
                    className="mr-1 h-6 shrink-0 rounded-sm px-2 text-label text-text-soft outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-danger/15 hover:text-danger focus-visible:bg-danger/15 focus-visible:text-danger"
                  >
                    Stop
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="border-line border-t p-1">
          <button
            type="button"
            data-entry="All threads"
            onClick={() => {
              onOpen(undefined)
              setOpen(false)
            }}
            className="group flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-label text-text-soft outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text focus-visible:bg-white/[0.07]"
          >
            All threads
            <span className="transition-transform duration-(--duration-quick) ease-soft group-hover:translate-x-0.5 [&_svg]:size-3">
              <ArrowGlyph />
            </span>
          </button>
        </div>
      </Floating>
    </>
  )
}
