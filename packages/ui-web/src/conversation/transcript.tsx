import type { Exchange, Persona, TurnId } from '@repo/protocol'
import { useLayoutEffect, useRef } from 'react'
import { ArrowGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { whoAsked } from './who-asked.ts'

export interface TranscriptProps {
  exchanges: readonly Exchange[]
  personas: readonly Persona[]
  /** Show the full answer a line's thread wrote, whole. */
  onOpenAnswer(turn: TurnId): void
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** What both sides said, as a log that follows the conversation: one step in from the main screen. */
export function Transcript({ exchanges, personas, onOpenAnswer }: TranscriptProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const count = exchanges.length
  const last = exchanges.at(-1)?.replied.length ?? 0
  // The log stays at its latest line as the conversation goes on. Only its own box scrolls: bringing a line into
  // view would also scroll every box around it, the window's included, while the sheet still slides in.
  useLayoutEffect(() => {
    const box = scroller.current
    if (box) box.scrollTop = box.scrollHeight
  }, [count, last])

  return (
    <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
      {exchanges.length === 0 ? (
        <p className="text-sm text-text-faint">Nothing has been said yet.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-5">
          {exchanges.map((exchange) => {
            const persona = personas.find((candidate) => candidate.id === exchange.persona)
            return (
              <li key={exchange.turn} className="grid grid-cols-1 gap-2" style={accentStyle(persona?.accent)}>
                <div className="grid grid-cols-1 gap-1">
                  <span className="flex items-baseline gap-2 text-label text-text-faint">
                    {whoAsked(exchange)} <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
                  </span>
                  {exchange.said && <p className="text-sm text-text-soft leading-relaxed [overflow-wrap:anywhere]">{exchange.said}</p>}
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
                      <span className="transition-transform duration-(--duration-quick) ease-soft group-hover:translate-x-0.5 [&_svg]:size-3">
                        <ArrowGlyph />
                      </span>
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
  )
}
