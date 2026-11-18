import type { Exchange, Persona } from '@repo/protocol'
import { useEffect, useRef } from 'react'
import { accentStyle } from '../styles/accent.ts'
import { Markdown } from '../view/blocks/markdown.tsx'
import { whoAsked } from './who-asked.ts'

export interface TranscriptProps {
  exchanges: readonly Exchange[]
  personas: readonly Persona[]
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** What both sides said, as a log that follows the conversation: one step in from the main screen. */
export function Transcript({ exchanges, personas }: TranscriptProps) {
  const end = useRef<HTMLDivElement>(null)
  const count = exchanges.length
  const last = exchanges.at(-1)?.replied.length ?? 0
  // The log stays at its latest line as the conversation goes on.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count, last])

  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {exchanges.length === 0 ? (
        <p className="text-sm text-text-faint">Nothing has been said yet.</p>
      ) : (
        <ol className="grid gap-5">
          {exchanges.map((exchange) => {
            const persona = personas.find((candidate) => candidate.id === exchange.persona)
            return (
              <li key={exchange.turn} className="grid gap-2" style={accentStyle(persona?.accent)}>
                <div className="grid gap-1">
                  <span className="flex items-baseline gap-2 text-label text-text-faint">
                    {whoAsked(exchange)} <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
                  </span>
                  {exchange.said && <p className="text-sm text-text-soft leading-relaxed">{exchange.said}</p>}
                </div>
                <div className="grid gap-1 border-accent/50 border-l pl-3">
                  <span className="text-accent text-label">{persona?.name ?? 'Assistant'}</span>
                  {exchange.replied && <p className="text-sm leading-relaxed">{exchange.replied}</p>}
                  {exchange.written && (
                    <details className="group mt-1">
                      <summary className="w-fit cursor-pointer list-none text-label text-text-faint transition-colors hover:text-text-soft">
                        <span className="inline-block transition-transform duration-150 group-open:rotate-90">›</span> Full answer
                      </summary>
                      <div className="mt-2 grid gap-3 rounded-md border border-line bg-ground/60 px-3 py-2.5 text-sm leading-relaxed [&_h3]:text-lg [&_h4]:text-base">
                        <Markdown text={exchange.written} />
                      </div>
                    </details>
                  )}
                  {exchange.outcome === 'running' && !exchange.replied && <p className="text-sm text-text-faint">…</p>}
                  {exchange.outcome === 'stopped' && <p className="text-label text-text-faint">Stopped</p>}
                  {exchange.outcome === 'failed' && <p className="text-danger text-sm leading-relaxed">{exchange.problem ?? 'It could not answer.'}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <div ref={end} />
    </div>
  )
}
