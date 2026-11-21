import type { Exchange, Thread } from '@repo/protocol'
import { Popover, PopoverContent, PopoverTrigger } from '@ui-sdk/react/popover'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { playCue } from '../audio/cues.ts'
import { findDevice } from '../audio/devices.ts'
import { useDevice } from '../device/device.tsx'
import { useNow } from '../hub/use-now.ts'
import { cn } from '../primitives/cn.ts'
import { CloseGlyph } from '../primitives/icons.tsx'
import { FLOATING, FLOATING_LIST, FLOATING_SHADOW, GAP, MARGIN } from '../primitives/menu.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import { StateDot } from './thread-list.tsx'

/** How many finished topics have a row under the caption; the others wait behind "more", so the stream never moves far. */
const SHOWN = 3

/** A finished topic as its row shows it: what its answer found, on one line, if the answer is in the conversation. */
interface ReadyRow {
  thread: Thread
  answer: string | undefined
}

/**
 * The finished topics in the order of the threads, the most recent first, each with what its latest answer found: the
 * title of the answer it wrote, which names the outcome, else what it said, which opens on what it set out to do.
 */
/** The first title of an answer written in Markdown, without its marks: what the answer names as its outcome. */
export const headingOf = (written: string | undefined): string | undefined => written?.match(/^#{1,6}[ \t]+(.+)$/m)?.[1]?.replace(/\*\*|`/g, '')

export function readyRows(ready: readonly Thread[], exchanges: readonly Exchange[]): ReadyRow[] {
  return ready.map((thread) => {
    const answer = exchanges.findLast((line) => line.thread === thread.id && line.outcome === 'done')
    const heading = headingOf(answer?.written)
    const line = (heading ?? answer?.replied ?? '').replace(/\s+/g, ' ').trim()
    return { thread, answer: line === '' ? undefined : line }
  })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long an answer has waited, in as few characters as a row has room for: "now", "4 min", "2 h", "3 d". */
export function waited(iso: string, now: Date): string {
  const passed = now.getTime() - new Date(iso).getTime()
  if (passed < MINUTE) return 'now'
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} min`
  if (passed < DAY) return `${Math.floor(passed / HOUR)} h`
  return `${Math.floor(passed / DAY)} d`
}

interface ReadyTopicsProps {
  /** Topics that finished while another was in focus. */
  ready: readonly Thread[]
  exchanges: readonly Exchange[]
  onFocus(thread: string): void
  /** Put one waiting answer away unseen, or with none named, all of them. */
  onDismiss(thread?: string): void
}

/**
 * Topics whose answer is waiting, as a short list under what the assistant is saying: each row names the topic, starts
 * its answer and says how long it has waited. Pressing a row brings the topic back; its cross, or Delete on the row,
 * puts the answer away unseen. Past a few, the others open from "more", and "Clear all" puts every one away.
 */
export function ReadyTopics({ ready, exchanges, onFocus, onDismiss }: ReadyTopicsProps) {
  // A new row comes with a soft sound when answers are heard on this device, for a person looking elsewhere. Those
  // already there when the window opens make none.
  const { settings } = useDevice()
  const known = useRef<ReadonlySet<string> | undefined>(undefined)
  useEffect(() => {
    const ids = new Set(ready.map((thread) => thread.id))
    const before = known.current
    known.current = ids
    if (before === undefined || !settings.voice.aloud || ![...ids].some((id) => !before.has(id))) return
    void findDevice(settings.speaker, 'audiooutput').then((sink) => playCue('ready', sink))
  }, [ready, settings.voice.aloud, settings.speaker])

  const now = useNow()
  const [moreOpen, setMoreOpen] = useState(false)
  const rows = readyRows(ready, exchanges)
  const more = rows.slice(SHOWN)
  const row = (one: ReadyRow) => <ReadyTopic row={one} now={now} onFocus={onFocus} onDismiss={onDismiss} />

  return (
    <section aria-label="Ready" className="grid w-full max-w-[34rem] grid-cols-1 gap-1">
      <ul className="grid grid-cols-1 gap-1">
        <AnimatePresence initial={false}>
          {rows.slice(0, SHOWN).map((one) => (
            <motion.li
              key={one.thread.id}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: DURATION.calm, ease: EASE }}
            >
              {row(one)}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {rows.length > 1 && (
        <div className="flex items-center justify-center gap-1 text-label text-text-faint">
          {more.length > 0 && (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger className={FOOT}>{`${more.length} more`}</PopoverTrigger>
              <PopoverContent side="bottom" align="center" sideOffset={GAP} collisionPadding={MARGIN} aria-label="More that is ready" className={FLOATING}>
                <span aria-hidden="true" className={FLOATING_SHADOW} />
                <ul
                  className={cn(
                    FLOATING_LIST,
                    'scroll-quiet grid grid-cols-1 max-h-[min(20rem,50vh)] w-[30rem] max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto p-1'
                  )}
                >
                  {more.map((one) => (
                    <li key={one.thread.id}>{row(one)}</li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <button type="button" onClick={() => onDismiss()} className={FOOT}>
            Clear all
          </button>
        </div>
      )}
    </section>
  )
}

const FOOT =
  'h-6 rounded-sm px-2 outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text-soft focus-visible:bg-white/[0.07] focus-visible:text-text-soft'

/** One finished topic: a press brings it back, the cross puts its answer away. */
function ReadyTopic({ row, now, onFocus, onDismiss }: { row: ReadyRow; now: Date; onFocus(thread: string): void; onDismiss(thread: string): void }) {
  const { thread, answer } = row
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    onDismiss(thread.id)
  }
  return (
    <div className="group flex h-8 items-center rounded-md bg-white/[0.045] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.07)] transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.07]">
      <button
        type="button"
        title="Bring it back"
        onClick={() => onFocus(thread.id)}
        onKeyDown={onKeyDown}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pr-1 pl-3 text-left outline-none focus-visible:bg-white/[0.07]"
      >
        <StateDot state="ready" />
        <span className={cn('min-w-0 truncate text-[0.8125rem] text-text', answer === undefined ? 'flex-1' : 'max-w-[45%] shrink-0')}>{thread.title}</span>
        {answer !== undefined && <span className="min-w-0 flex-1 truncate text-[0.75rem] text-text-faint">{answer}</span>}
        <span className="shrink-0 text-label text-text-faint tabular-nums">{waited(thread.at, now)}</span>
      </button>
      <button
        type="button"
        aria-label={`Dismiss ${thread.title}`}
        title="Dismiss"
        onClick={() => onDismiss(thread.id)}
        className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-text-faint outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.08] hover:text-text focus-visible:bg-white/[0.08] focus-visible:text-text [&_svg]:size-3"
      >
        <CloseGlyph />
      </button>
    </div>
  )
}
