import type { Exchange, Thread } from '@repo/protocol'
import { useId, useRef, useState } from 'react'
import { BAR_LABEL } from '../access/access-indicator.tsx'
import { lastPart } from '../changes/words.ts'
import { Floating } from '../primitives/menu.tsx'
import { StateDot } from './thread-list.tsx'

/** What a thread at work is answering, in the person's words: the latest of its requests still running. */
export function answeringOf(thread: string, exchanges: readonly Exchange[]): string | undefined {
  const said = exchanges.findLast((line) => line.thread === thread && line.outcome === 'running')?.said.trim()
  return said === '' ? undefined : said
}

/**
 * The threads at work, under the composer: a few words saying how many, which open the list of them. Each can be
 * brought to the screen, or stopped on its own while the others go on.
 */
export function RunningThreads({
  threads,
  exchanges,
  onFocus,
  onStop
}: {
  threads: readonly Thread[]
  exchanges: readonly Exchange[]
  onFocus(thread: string): void
  onStop(thread: string): void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  const working = threads.filter((thread) => thread.state === 'working')
  if (working.length === 0) return null

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
        {working.length === 1 ? '1 at work' : `${working.length} at work`}
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
        className="w-[20rem]"
      >
        <ul className="grid gap-px p-1">
          {working.map((thread) => {
            const answering = answeringOf(thread.id, exchanges)
            return (
              <li key={thread.id} className="flex items-center gap-1 rounded-sm hover:bg-white/[0.05]">
                <button
                  type="button"
                  data-entry={thread.title}
                  onClick={() => {
                    onFocus(thread.id)
                    setOpen(false)
                  }}
                  title="Show it"
                  className="grid min-w-0 flex-1 gap-0.5 rounded-sm px-2.5 py-1.5 text-left outline-none focus-visible:bg-white/[0.07]"
                >
                  <span className="truncate text-[0.8125rem] text-text">{thread.title}</span>
                  <span className="truncate text-label text-text-faint">
                    {thread.folder && <span title={thread.folder}>in {lastPart(thread.folder)} · </span>}
                    {answering ?? 'working'}
                  </span>
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
              </li>
            )
          })}
        </ul>
      </Floating>
    </>
  )
}
