import type { Exchange, Persona, Threads } from '@repo/protocol'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'

export interface TranscriptProps {
  exchanges: readonly Exchange[]
  personas: readonly Persona[]
  threads: Threads
  onFocus(thread: string): void
  onClose(): void
}

const STATE = { working: 'Working', ready: 'Ready', parked: 'Idle' } as const

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * One step in from the main screen: what both sides said, as a log that follows the conversation, and the
 * threads working behind it.
 */
export function Transcript({ exchanges, personas, threads, onFocus, onClose }: TranscriptProps) {
  const [tab, setTab] = useState<'transcript' | 'threads'>('transcript')
  const end = useRef<HTMLDivElement>(null)
  const count = exchanges.length
  const last = exchanges.at(-1)?.replied.length ?? 0
  // The log stays at its latest line as the conversation goes on.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count, last])

  return (
    <aside aria-label="Transcript" className="flex h-full w-[23rem] shrink-0 flex-col border-line border-l bg-surface/85 backdrop-blur-md">
      <div className="flex h-12 items-center justify-between border-line border-b pr-2.5 pl-3">
        <div role="tablist" className="flex items-center gap-1">
          {(['transcript', 'threads'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                'h-7 rounded-sm px-2.5 font-mono text-label uppercase transition',
                tab === name ? 'bg-raised text-text' : 'text-text-faint hover:text-text-soft'
              )}
            >
              {name === 'threads' ? `Threads${threads.threads.length ? ` · ${threads.threads.length}` : ''}` : 'Transcript'}
            </button>
          ))}
        </div>
        <IconButton label="Close the panel" onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      </div>
      {tab === 'threads' ? (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {threads.threads.length === 0 ? (
            <p className="px-2 py-1 text-sm text-text-faint">Topics appear here as the conversation opens them.</p>
          ) : (
            <ul className="grid gap-1">
              {threads.threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    disabled={thread.kind === 'aside'}
                    onClick={() => onFocus(thread.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition enabled:hover:bg-raised',
                      threads.focus === thread.id && 'bg-raised'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        thread.state === 'working' && 'animate-pulse bg-accent',
                        thread.state === 'ready' && 'bg-accent shadow-[0_0_8px_var(--accent)]',
                        thread.state === 'parked' && 'bg-text-faint/60'
                      )}
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm">{thread.title}</span>
                      <span className="font-mono text-label text-text-faint uppercase">
                        {thread.kind === 'aside' ? 'Aside' : 'Topic'} · {STATE[thread.state]}
                        {threads.focus === thread.id ? ' · on screen' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
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
      )}
    </aside>
  )
}
