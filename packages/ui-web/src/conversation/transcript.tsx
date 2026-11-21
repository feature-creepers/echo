import type { Exchange, Persona, Thread, TurnId } from '@repo/protocol'
import { useState } from 'react'
import { AttachedLine } from '../attachments/attached-line.tsx'
import { cn } from '../primitives/cn.ts'
import { accentStyle } from '../styles/accent.ts'
import { useFollowLatest } from './follow-latest.ts'
import { GoArrow } from './go-arrow.tsx'
import { LatestButton } from './latest-button.tsx'
import { headingOf } from './ready-topics.tsx'
import { whoAsked } from './who-asked.ts'

interface TranscriptProps {
  exchanges: readonly Exchange[]
  /** The threads behind the lines, to name the one each line went to. */
  threads: readonly Thread[]
  personas: readonly Persona[]
  /** Show the full answer a line's thread wrote, whole. */
  onOpenAnswer(turn: TurnId): void
  /** Show the work of the thread a line went to. */
  onOpenThread(thread: string): void
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * What the assistant answered, on one line: what it said, else the title of what it wrote. Nothing when it said and
 * wrote nothing, as a turn still running or stopped.
 */
export function answerLine(exchange: Pick<Exchange, 'replied' | 'written'>): string | undefined {
  const line = (exchange.replied?.trim() ? exchange.replied : (headingOf(exchange.written) ?? '')).replace(/\s+/g, ' ').trim()
  return line === '' ? undefined : line
}

/**
 * What both sides said, read from the end (docs/SPEC.md, section 13.3), each turn as an answer of the main screen
 * reads: its time, and who asked when it was not the person; what was asked, in the soft ink; then what the assistant
 * said, in the full ink; a few lines each and whole when pressed, with its full answer and its thread to open, and a
 * hairline before the next. It opens at the latest turn and follows the conversation while the person stays at the
 * end; scrolled up, nothing moves under their eyes, and "Latest" takes them back.
 */
export function Transcript({ exchanges, threads, personas, onOpenAnswer, onOpenThread }: TranscriptProps) {
  // Only its own box scrolls: bringing a line into view would also scroll every box around it, the window's
  // included, while the sheet still slides in.
  const scroll = useFollowLatest()
  const [whole, setWhole] = useState<ReadonlySet<TurnId>>(new Set())
  const toggle = (turn: TurnId) => setWhole((before) => new Set(before.has(turn) ? [...before].filter((one) => one !== turn) : [...before, turn]))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroll.ref}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-1 pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]"
      >
        {exchanges.length === 0 ? (
          <p className="pt-2 text-[0.8125rem] text-text-soft">Nothing has been said yet.</p>
        ) : (
          <ol className="grid grid-cols-1">
            {exchanges.map((exchange) => {
              const persona = personas.find((candidate) => candidate.id === exchange.persona)
              const thread = exchange.thread === undefined ? undefined : threads.find((one) => one.id === exchange.thread)
              const asked = whoAsked(exchange)
              const answer = answerLine(exchange)
              const open = whole.has(exchange.turn)
              return (
                <li key={exchange.turn} className="grid grid-cols-1 gap-1.5 border-line border-t py-3 first:border-t-0" style={accentStyle(persona?.accent)}>
                  <span className="caps flex min-w-0 items-center gap-2 text-text-soft">
                    <time dateTime={exchange.at} className="tabular-nums">
                      {clock.format(new Date(exchange.at))}
                    </time>
                    {asked !== 'You' && <span className="truncate">{asked}</span>}
                    {exchange.outcome === 'running' && <span className="ml-auto text-accent">Answering</span>}
                    {exchange.outcome === 'stopped' && <span className="ml-auto">Stopped</span>}
                  </span>
                  {exchange.said && (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(exchange.turn)}
                      className={cn(
                        'min-w-0 text-left text-[0.8125rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]',
                        !open && (asked === 'You' ? 'line-clamp-4' : 'line-clamp-1')
                      )}
                    >
                      {exchange.said}
                    </button>
                  )}
                  <AttachedLine attached={exchange.attached} />
                  {answer && (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(exchange.turn)}
                      className={cn('min-w-0 text-left text-[0.8125rem] text-text leading-relaxed [overflow-wrap:anywhere]', !open && 'line-clamp-4')}
                    >
                      {answer}
                    </button>
                  )}
                  {exchange.outcome === 'failed' && (
                    <span className="text-[0.8125rem] text-danger leading-snug [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</span>
                  )}
                  {(exchange.written || thread) && (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                      {exchange.written && <Link onClick={() => onOpenAnswer(exchange.turn)}>Full answer</Link>}
                      {thread && (
                        <Link onClick={() => onOpenThread(thread.id)} title={`Show the work of ${thread.title}`}>
                          {thread.title}
                        </Link>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <LatestButton scroll={scroll} />
    </div>
  )
}

/** A small way into what a turn led to, in capitals with an arrow: its full answer, its thread. */
function Link({ children, onClick, title }: { children: string; onClick(): void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="caps group flex h-5 min-w-0 max-w-full items-center gap-1 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
    >
      <span className="min-w-0 truncate">{children}</span>
      <GoArrow />
    </button>
  )
}
