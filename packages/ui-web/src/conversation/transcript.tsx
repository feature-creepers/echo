import type { Exchange, Persona } from '@repo/protocol'
import { useEffect, useRef } from 'react'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'

export interface TranscriptProps {
  exchanges: readonly Exchange[]
  personas: readonly Persona[]
  onClose(): void
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** What both sides said, as a log that follows the conversation. One step in from the main screen. */
export function Transcript({ exchanges, personas, onClose }: TranscriptProps) {
  const end = useRef<HTMLDivElement>(null)
  const count = exchanges.length
  const last = exchanges.at(-1)?.replied.length ?? 0
  // The log stays at its latest line as the conversation goes on.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count, last])

  return (
    <aside aria-label="Transcript" className="flex h-full w-[23rem] shrink-0 flex-col border-line border-l bg-surface/85 backdrop-blur-md">
      <div className="flex h-12 items-center justify-between border-line border-b pr-2.5 pl-5">
        <Eyebrow>Transcript</Eyebrow>
        <IconButton label="Close the transcript" onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      </div>
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
                    <span className="flex items-baseline gap-2 font-mono text-label text-text-faint uppercase">
                      You <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
                    </span>
                    <p className="text-sm text-text-soft leading-relaxed">{exchange.said}</p>
                  </div>
                  <div className="grid gap-1 border-accent/50 border-l pl-3">
                    <span className="font-mono text-accent text-label uppercase">{persona?.name ?? 'Assistant'}</span>
                    {exchange.replied && <p className="text-sm leading-relaxed">{exchange.replied}</p>}
                    {exchange.outcome === 'running' && !exchange.replied && <p className="text-sm text-text-faint">…</p>}
                    {exchange.outcome === 'stopped' && <p className="font-mono text-label text-text-faint uppercase">Stopped</p>}
                    {exchange.outcome === 'failed' && <p className="text-danger text-sm leading-relaxed">{exchange.problem ?? 'It could not answer.'}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <div ref={end} />
      </div>
    </aside>
  )
}
