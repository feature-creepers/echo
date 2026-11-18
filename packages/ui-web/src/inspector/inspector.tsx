import type { Logged } from '@repo/client'
import { useState } from 'react'
import { stepSummary } from '../conversation/thread-view.tsx'

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })

/** The raw events from the core, newest first, each opened on demand. For those who want to see everything. */
export function Inspector({ events }: { events: readonly Logged[] }) {
  const [open, setOpen] = useState<number>()
  if (events.length === 0) return <p className="px-5 py-4 text-sm text-text-faint">Events from the core appear here as they arrive.</p>
  const newest = [...events].reverse()
  return (
    <ol className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2 font-mono text-[0.6875rem]">
      {newest.map((logged) => {
        const { event } = logged
        const summary =
          event.name === 'speech.say'
            ? event.text
            : event.name === 'activity'
              ? `${event.tool} ${event.phase}${event.step && stepSummary(event.step) ? ` · ${stepSummary(event.step)}` : ''}`
              : event.name === 'answer.written'
                ? `${event.exchange.written?.length ?? 0} characters`
                : event.name === 'turn.started' || event.name === 'turn.ended'
                  ? `${event.exchange.outcome}${event.exchange.thread ? ` · thread ${event.exchange.thread.slice(0, 8)}` : ''}`
                  : event.name === 'view.shown'
                    ? `${event.view.title} · ${event.view.slot}${event.view.widget ? ' · saved' : ''}`
                    : event.name === 'library.changed'
                      ? `${event.library.widgets.length} saved`
                      : ''
        return (
          <li key={`${logged.at}-${event.name}-${summary}`}>
            <button
              type="button"
              onClick={() => setOpen(open === logged.at ? undefined : logged.at)}
              className="flex w-full items-baseline gap-2 px-4 py-1 text-left hover:bg-raised"
            >
              <span className="shrink-0 text-text-faint tabular-nums">{time.format(logged.at)}</span>
              <span className="shrink-0 text-accent">{event.name}</span>
              <span className="min-w-0 truncate text-text-soft">{summary}</span>
            </button>
            {open === logged.at && (
              // Wrapped rather than scrolled sideways: an event can hold a long answer, an address or a path.
              <pre className="mx-4 mb-2 whitespace-pre-wrap rounded-sm bg-ground p-3 text-text-soft leading-relaxed [overflow-wrap:anywhere]">
                {JSON.stringify(event, null, 2)}
              </pre>
            )}
          </li>
        )
      })}
    </ol>
  )
}
