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
 * What both sides said, as compact turns read from the end (docs/SPEC.md, section 13.2): each turn is the time, what
 * was said, and the assistant's answer on a line or two, with its full answer and its thread to open. Pressing a turn
 * shows its words whole. It opens at the latest turn and follows the conversation while the person stays at the end;
 * scrolled up, nothing moves under their eyes, and "Latest" takes them back.
 */
export function Transcript({ exchanges, threads, personas, onOpenAnswer, onOpenThread }: TranscriptProps) {
  // Only its own box scrolls: bringing a line into view would also scroll every box around it, the window's
  // included, while the sheet still slides in.
  const scroll = useFollowLatest()
  const [whole, setWhole] = useState<ReadonlySet<TurnId>>(new Set())
  const toggle = (turn: TurnId) => setWhole((before) => new Set(before.has(turn) ? [...before].filter((one) => one !== turn) : [...before, turn]))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroll.ref} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
        {exchanges.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing has been said yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-3.5">
            {exchanges.map((exchange) => {
              const persona = personas.find((candidate) => candidate.id === exchange.persona)
              const thread = exchange.thread === undefined ? undefined : threads.find((one) => one.id === exchange.thread)
              const asked = whoAsked(exchange)
              const answer = answerLine(exchange)
              const open = whole.has(exchange.turn)
              return (
                <li key={exchange.turn} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-1.5" style={accentStyle(persona?.accent)}>
                  <time className="whitespace-nowrap pt-px text-[0.6875rem] text-text-faint tabular-nums" dateTime={exchange.at}>
                    {clock.format(new Date(exchange.at))}
                  </time>
                  <div className="grid min-w-0 grid-cols-1 gap-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(exchange.turn)}
                      title={open ? 'Show less' : 'Show it whole'}
                      className="grid min-w-0 grid-cols-1 gap-1 rounded-xs text-left outline-none focus-visible:bg-white/[0.04]"
                    >
                      {(exchange.said || asked !== 'You') && (
                        <span className={cn('text-[0.8125rem] text-text-soft leading-snug [overflow-wrap:anywhere]', !open && 'line-clamp-2')}>
                          {asked !== 'You' && <span className="text-text-faint">{exchange.said ? `${asked} · ` : asked}</span>}
                          {exchange.said}
                        </span>
                      )}
                      {answer && (
                        <span
                          className={cn(
                            'border-accent/50 border-l-2 pl-2 text-[0.8125rem] text-text leading-snug [overflow-wrap:anywhere]',
                            !open && 'line-clamp-2'
                          )}
                        >
                          {answer}
                        </span>
                      )}
                    </button>
                    <AttachedLine attached={exchange.attached} />
                    {exchange.outcome === 'running' && !answer && <span className="text-label text-text-faint">Answering…</span>}
                    {exchange.outcome === 'failed' && (
                      <span className="text-danger text-xs leading-snug [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</span>
                    )}
                    {(exchange.written || thread || exchange.outcome === 'stopped') && (
                      <span className="flex min-w-0 flex-wrap items-center gap-1">
                        {exchange.written && <Chip onClick={() => onOpenAnswer(exchange.turn)}>Full answer</Chip>}
                        {thread && (
                          <Chip onClick={() => onOpenThread(thread.id)} title={`Show the work of ${thread.title}`}>
                            {thread.title}
                          </Chip>
                        )}
                        {exchange.outcome === 'stopped' && <span className="px-1 text-[0.6875rem] text-text-faint">Stopped</span>}
                      </span>
                    )}
                  </div>
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

/** A small way into what a turn led to: its full answer, its thread. */
function Chip({ children, onClick, title }: { children: string; onClick(): void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="group flex h-5 min-w-0 max-w-full items-center gap-0.5 rounded-xs bg-white/[0.05] px-1.5 text-[0.6875rem] text-text-soft outline-none transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.09] hover:text-text focus-visible:bg-white/[0.09]"
    >
      <span className="min-w-0 truncate">{children}</span>
      <GoArrow />
    </button>
  )
}
