import type { Exchange, Persona, Thread, TurnId } from '@repo/protocol'
import { AttachedLine } from '../attachments/attached-line.tsx'
import { accentStyle } from '../styles/accent.ts'
import { useFollowLatest } from './follow-latest.ts'
import { GoArrow } from './go-arrow.tsx'
import { LatestButton } from './latest-button.tsx'
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
 * What both sides said, as a log read from its end: one step in from the main screen. It opens at the latest line
 * and follows the conversation while the person stays at the end; scrolled up, nothing moves under their eyes, and
 * "Latest" takes them back. Each line names the thread that answered it, which opens its work.
 */
export function Transcript({ exchanges, threads, personas, onOpenAnswer, onOpenThread }: TranscriptProps) {
  // Only its own box scrolls: bringing a line into view would also scroll every box around it, the window's
  // included, while the sheet still slides in.
  const scroll = useFollowLatest(exchanges[0]?.turn)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroll.ref} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
        <div>
          {exchanges.length === 0 ? (
            <p className="text-sm text-text-faint">Nothing has been said yet.</p>
          ) : (
            <ol className="grid grid-cols-1 gap-5">
              {exchanges.map((exchange) => {
                const persona = personas.find((candidate) => candidate.id === exchange.persona)
                const thread = exchange.thread === undefined ? undefined : threads.find((one) => one.id === exchange.thread)
                return (
                  <li key={exchange.turn} className="grid grid-cols-1 gap-2" style={accentStyle(persona?.accent)}>
                    <div className="grid grid-cols-1 gap-1">
                      <span className="flex min-w-0 items-baseline gap-2 text-label text-text-faint">
                        <span className="shrink-0">{whoAsked(exchange)}</span>
                        <time className="shrink-0" dateTime={exchange.at}>
                          {clock.format(new Date(exchange.at))}
                        </time>
                        {thread && (
                          <button
                            type="button"
                            onClick={() => onOpenThread(thread.id)}
                            title={`Show the work of ${thread.title}`}
                            className="group ml-auto flex min-w-0 items-center gap-1 rounded-xs transition-colors hover:text-text-soft"
                          >
                            <span className="min-w-0 truncate">{thread.title}</span>
                            <GoArrow />
                          </button>
                        )}
                      </span>
                      {exchange.said && <p className="text-sm text-text-soft leading-relaxed [overflow-wrap:anywhere]">{exchange.said}</p>}
                      <AttachedLine attached={exchange.attached} />
                    </div>
                    <div className="grid grid-cols-1 gap-1 border-accent/50 border-l pl-3">
                      <span className="text-accent text-label">{persona?.name ?? 'Assistant'}</span>
                      {exchange.replied && <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{exchange.replied}</p>}
                      {exchange.written && (
                        <button
                          type="button"
                          onClick={() => onOpenAnswer(exchange.turn)}
                          className="group mt-1 flex w-fit items-center gap-1 rounded-xs text-label text-text-faint transition-colors hover:text-text-soft"
                        >
                          Full answer
                          <GoArrow />
                        </button>
                      )}
                      {exchange.outcome === 'running' && !exchange.replied && <p className="text-sm text-text-faint">…</p>}
                      {exchange.outcome === 'stopped' && <p className="text-label text-text-faint">Stopped</p>}
                      {exchange.outcome === 'failed' && (
                        <p className="text-danger text-sm leading-relaxed [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
      <LatestButton scroll={scroll} />
    </div>
  )
}
