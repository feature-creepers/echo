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
 * What both sides said, read from the end (docs/SPEC.md, section 13.2): what the person said on the right, the
 * assistant's answer under it, a few lines each and whole when pressed, with its full answer and its thread to open.
 * What the assistant started by itself or was handed is a thin line saying why. Pointed at, a turn shows its time. It opens at the latest turn and follows the conversation while the person stays at the end;
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
      <div
        ref={scroll.ref}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]"
      >
        {exchanges.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing has been said yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-4">
            {exchanges.map((exchange) => {
              const persona = personas.find((candidate) => candidate.id === exchange.persona)
              const thread = exchange.thread === undefined ? undefined : threads.find((one) => one.id === exchange.thread)
              const asked = whoAsked(exchange)
              const answer = answerLine(exchange)
              const open = whole.has(exchange.turn)
              const time = clock.format(new Date(exchange.at))
              return (
                <li key={exchange.turn} className="group grid grid-cols-1 gap-1.5" style={accentStyle(persona?.accent)}>
                  {asked === 'You' ? (
                    // What the person said, on the right, as T3 Code and every conversation show it.
                    exchange.said && (
                      <div className="flex justify-end pl-10">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggle(exchange.turn)}
                          title={time}
                          className={cn(
                            'min-w-0 rounded-lg rounded-br-sm bg-white/[0.07] px-3 py-1.5 text-left text-[0.8125rem] text-text leading-relaxed outline-none [overflow-wrap:anywhere] focus-visible:bg-white/[0.1]',
                            !open && 'line-clamp-4'
                          )}
                        >
                          {exchange.said}
                        </button>
                      </div>
                    )
                  ) : (
                    // What the assistant started by itself, or was handed: a thin line saying why, its words one press away.
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(exchange.turn)}
                      className="flex min-w-0 items-center gap-2 text-[0.6875rem] text-text-faint outline-none hover:text-text-soft focus-visible:text-text-soft"
                    >
                      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-line" />
                      <span className="shrink-0 font-medium">{asked}</span>
                      <span className="shrink-0 tabular-nums">{time}</span>
                      {exchange.said && <span className={cn('min-w-0 text-left', open ? '[overflow-wrap:anywhere]' : 'truncate')}>{exchange.said}</span>}
                      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-line" />
                    </button>
                  )}
                  <AttachedLine attached={exchange.attached} />
                  {answer && (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(exchange.turn)}
                      className={cn(
                        'min-w-0 rounded-sm text-left text-[0.8125rem] text-text leading-relaxed outline-none [overflow-wrap:anywhere] focus-visible:bg-white/[0.04]',
                        !open && 'line-clamp-4'
                      )}
                    >
                      {answer}
                    </button>
                  )}
                  {exchange.outcome === 'running' && !answer && <span className="text-label text-text-faint">Answering…</span>}
                  {exchange.outcome === 'failed' && (
                    <span className="text-danger text-xs leading-snug [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</span>
                  )}
                  <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-1">
                    {exchange.written && <Chip onClick={() => onOpenAnswer(exchange.turn)}>Full answer</Chip>}
                    {thread && (
                      <Chip onClick={() => onOpenThread(thread.id)} title={`Show the work of ${thread.title}`}>
                        {thread.title}
                      </Chip>
                    )}
                    {exchange.outcome === 'stopped' && <span className="px-1 text-[0.6875rem] text-text-faint">Stopped</span>}
                    {/* The time of what the person said shows where they look for it, as the row is pointed at. */}
                    {asked === 'You' && (
                      <time
                        dateTime={exchange.at}
                        className="ml-auto text-[0.6875rem] text-text-faint tabular-nums opacity-0 transition-opacity duration-(--duration-quick) ease-soft group-hover:opacity-100"
                      >
                        {time}
                      </time>
                    )}
                  </span>
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
