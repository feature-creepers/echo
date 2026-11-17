import type { Client, ThreadRead } from '@repo/client'
import type { Exchange, Persona, Step } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { BackGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { Markdown } from '../view/blocks/markdown.tsx'
import { StateDot } from './thread-list.tsx'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const STATE = { working: 'Working', ready: 'Ready', parked: 'Idle' } as const

/** What each tool did, in a few words, for the list of calls. */
const TOOL_TITLES: Record<string, string> = {
  web_search: 'Searched the web',
  web_read: 'Read a page',
  ui_render: 'Showed a view',
  ui_clear: 'Cleared the screen',
  answer_write: 'Wrote the full answer',
  thread_open: 'Opened this thread',
  thread_send: 'Passed it to this thread',
  thread_focus: 'Brought a topic back',
  file_write: 'Wrote a document',
  file_read: 'Read a document',
  memory_search: 'Searched the memory',
  memory_remember: 'Remembered',
  memory_forget: 'Forgot',
  library_search: 'Searched the library',
  library_show: 'Showed a saved widget',
  library_save: 'Saved a widget',
  library_update: 'Changed a saved widget',
  library_delete: 'Deleted a saved widget'
}

/** The one line that says what a call was about: the query, the address, the view's title. */
export function stepSummary(step: Step): string | undefined {
  const input = step.input
  if (typeof input !== 'object' || input === null) return typeof input === 'string' ? input : undefined
  const fields = input as Record<string, unknown>
  for (const name of ['query', 'url', 'title', 'request', 'name', 'thread']) {
    const value = fields[name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return Object.values(fields).find((value): value is string => typeof value === 'string' && value.trim() !== '')
}

export interface ThreadViewProps {
  client: Client
  thread: string
  personas: readonly Persona[]
  onBack(): void
}

/**
 * One thread, whole, for those who want to see the work: each thing asked, every tool call with what went in
 * and came out (folded until opened), what was said aloud, and the full written answer. Kept current while
 * the thread works.
 */
export function ThreadView({ client, thread, personas, onBack }: ThreadViewProps) {
  const [read, setRead] = useState<ThreadRead | { problem: string }>()

  const load = useCallback(() => {
    client.threads
      .read(thread)
      .then(setRead)
      .catch((error: unknown) => setRead({ problem: error instanceof Error ? error.message : String(error) }))
  }, [client, thread])

  // Read again, a moment after anything that concerns this thread, so a working thread fills in as it goes.
  useEffect(() => {
    load()
    let timer: number | undefined
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 200)
    }
    const stop = client.session.onEvent((event) => {
      const concerns =
        (event.name === 'activity' && event.step?.thread === thread) ||
        ((event.name === 'turn.started' || event.name === 'turn.ended' || event.name === 'answer.written') && event.exchange.thread === thread) ||
        (event.name === 'view.shown' && event.view.thread === thread) ||
        event.name === 'threads.changed'
      if (concerns) soon()
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [client, thread, load])

  const header = read && 'thread' in read ? read.thread : client.threads.current().threads.find((one) => one.id === thread)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2 border-line border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex w-fit items-center gap-1 rounded-sm px-1 py-0.5 text-text-faint text-xs transition-colors hover:text-text"
        >
          <BackGlyph /> Threads
        </button>
        {header && (
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <span className="font-medium text-[0.9375rem] leading-snug">{header.title}</span>
              <span className="flex items-center gap-2 font-mono text-label text-text-faint uppercase">
                <StateDot state={header.state} />
                {header.kind === 'aside' ? 'Aside' : 'Topic'} · {STATE[header.state]}
              </span>
            </div>
            <Button kind="quiet" size="sm" className="shrink-0" onClick={() => void client.threads.focus(thread).catch(() => undefined)}>
              {header.kind === 'aside' ? 'Show the card' : 'Show on screen'}
            </Button>
          </div>
        )}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {read === undefined ? (
          <p className="text-sm text-text-faint">Reading…</p>
        ) : 'problem' in read ? (
          <p className="text-danger text-sm">{read.problem}</p>
        ) : read.exchanges.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing has been answered here yet.</p>
        ) : (
          <ol className="grid gap-6">
            {read.exchanges.map((exchange) => (
              <ExchangeEntry
                key={exchange.turn}
                exchange={exchange}
                steps={read.steps.filter((step) => step.turn === exchange.turn)}
                views={read.views.filter((view) => view.turn === exchange.turn).map((view) => view.title)}
                persona={personas.find((candidate) => candidate.id === exchange.persona)}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function ExchangeEntry({ exchange, steps, views, persona }: { exchange: Exchange; steps: Step[]; views: string[]; persona: Persona | undefined }) {
  // Views shown before calls were kept have no call to show them by.
  const shownByCalls = steps.some((step) => step.tool === 'ui_render')
  return (
    <li className="grid gap-3" style={accentStyle(persona?.accent)}>
      <div className="grid gap-1">
        <span className="flex items-baseline gap-2 font-mono text-label text-text-faint uppercase">
          {exchange.trigger === 'greeting' ? 'Briefing' : 'You'} <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
        </span>
        {exchange.said && <p className="text-sm text-text-soft leading-relaxed">{exchange.said}</p>}
      </div>

      {(steps.length > 0 || (!shownByCalls && views.length > 0)) && (
        <div className="grid gap-1">
          <Eyebrow>Work</Eyebrow>
          <ul className="grid overflow-hidden rounded-md border border-line">
            {steps.map((step) => (
              <StepRow key={step.call} step={step} />
            ))}
            {!shownByCalls &&
              views.map((title) => (
                <li key={title} className="flex items-baseline gap-2 border-line border-t px-3 py-2 text-xs first:border-t-0">
                  <span className="shrink-0 text-text-soft">Showed a view</span>
                  <span className="truncate text-text-faint">{title}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="grid gap-1 border-accent/50 border-l pl-3">
        <span className="font-mono text-accent text-label uppercase">{persona?.name ?? 'Assistant'} said</span>
        {exchange.replied ? (
          <p className="text-sm leading-relaxed">{exchange.replied}</p>
        ) : exchange.outcome === 'running' ? (
          <p className="text-sm text-text-faint">…</p>
        ) : null}
        {exchange.outcome === 'stopped' && <p className="font-mono text-label text-text-faint uppercase">Stopped</p>}
        {exchange.outcome === 'failed' && <p className="text-danger text-sm leading-relaxed">{exchange.problem ?? 'It could not answer.'}</p>}
      </div>

      {exchange.written && (
        <div className="grid gap-2">
          <Eyebrow>Full answer</Eyebrow>
          <div className="grid gap-3 rounded-md border border-line bg-ground/60 px-4 py-3 text-sm leading-relaxed [&_h3]:text-lg [&_h4]:text-base">
            <Markdown text={exchange.written} />
          </div>
        </div>
      )}
    </li>
  )
}

/** One tool call: what it did and on what, opened to show its input and its output whole. */
function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false)
  const summary = stepSummary(step)
  const running = step.ended === undefined
  const seconds = step.ended && step.at ? (new Date(step.ended).getTime() - new Date(step.at).getTime()) / 1000 : undefined
  return (
    <li className="border-line border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-raised"
      >
        <span aria-hidden="true" className={cn('w-2 shrink-0 text-text-faint transition-transform duration-150', open && 'rotate-90')}>
          ›
        </span>
        <span className={cn('shrink-0', step.failed ? 'text-danger' : 'text-text-soft')}>{TOOL_TITLES[step.tool] ?? step.tool}</span>
        <span className="min-w-0 flex-1 truncate text-text-faint">{summary}</span>
        <span className="shrink-0 font-mono text-[0.625rem] text-text-faint tabular-nums">
          {running ? <span className="animate-pulse text-accent">running</span> : seconds !== undefined ? `${seconds.toFixed(1)} s` : ''}
        </span>
      </button>
      {open && (
        <div className="grid gap-2 px-3 pb-3">
          <Detail label={`${step.tool} · input`} text={step.input === undefined ? '—' : JSON.stringify(step.input, null, 2)} />
          <Detail label="Output" text={step.output ?? (running ? 'Still running.' : '—')} />
        </div>
      )}
    </li>
  )
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid gap-1">
      <span className="font-mono text-[0.625rem] text-text-faint uppercase tracking-wide">{label}</span>
      <pre className="scroll-quiet max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-ground p-2.5 font-mono text-[0.6875rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  )
}
