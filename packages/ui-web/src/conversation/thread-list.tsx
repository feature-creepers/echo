import type { Threads } from '@repo/protocol'
import { cn } from '../primitives/cn.ts'

const STATE = { working: 'Working', ready: 'Ready', parked: 'Idle' } as const

/** The topics working behind the one conversation. A topic is brought back on screen by pressing it. */
export function ThreadList({ threads, onFocus }: { threads: Threads; onFocus(thread: string): void }) {
  return (
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
  )
}
