import type { Thread, Threads } from '@repo/protocol'
import { lastPart } from '../changes/words.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'

const STATE = { working: 'working', ready: 'ready', parked: 'idle' } as const

/** What each kind of thread is called, on its row and over its work. */
export const KIND = { topic: 'Topic', aside: 'Aside', subthread: 'Sub-thread' } as const

/** A topic, and the asides asked beside it and the sub-threads it handed work to, the most recent first. */
export interface TopicGroup {
  topic: Thread
  asides: Thread[]
}

/**
 * The threads as the side sheet lists them: each topic with the asides asked while it was on the stage and the
 * sub-threads it opened under it. Asides from before they knew their topic, and those whose topic is gone, are
 * listed apart.
 */
export function groupThreads(threads: readonly Thread[]): { groups: TopicGroup[]; loose: Thread[] } {
  const topics = threads.filter((thread) => thread.kind === 'topic')
  const ids = new Set(topics.map((topic) => topic.id))
  const groups = topics.map((topic) => ({ topic, asides: threads.filter((thread) => thread.kind !== 'topic' && thread.parent === topic.id) }))
  const loose = threads.filter((thread) => thread.kind !== 'topic' && (thread.parent === undefined || !ids.has(thread.parent)))
  return { groups, loose }
}

/** The topics working behind the one conversation, with their asides. Pressing one opens it whole; one at work can be stopped. */
export function ThreadList({ threads, onOpen, onStop }: { threads: Threads; onOpen(thread: string): void; onStop?(thread: string): void }) {
  if (threads.threads.length === 0) {
    return <p className="px-5 py-4 text-sm text-text-faint">Topics appear here as the conversation opens them.</p>
  }
  const { groups, loose } = groupThreads(threads.threads)
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul className="grid gap-px">
        {groups.map(({ topic, asides }) => (
          <li key={topic.id}>
            <Row thread={topic} onScreen={threads.focus === topic.id} onOpen={onOpen} onStop={onStop} />
            {asides.length > 0 && (
              <ul className="mb-1 ml-[1.375rem] grid gap-px border-line border-l pl-1.5">
                {asides.map((aside) => (
                  <li key={aside.id}>
                    <Row thread={aside} onOpen={onOpen} onStop={onStop} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {loose.length > 0 && (
        <div className="mt-3 grid gap-1">
          <Eyebrow className="px-3">{loose.every((thread) => thread.kind === 'aside') ? 'Asides' : 'Without their topic'}</Eyebrow>
          <ul className="grid gap-px">
            {loose.map((aside) => (
              <li key={aside.id}>
                <Row thread={aside} onOpen={onOpen} onStop={onStop} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Row({
  thread,
  onScreen = false,
  onOpen,
  onStop
}: {
  thread: Thread
  onScreen?: boolean
  onOpen(thread: string): void
  onStop?: ((thread: string) => void) | undefined
}) {
  const stoppable = onStop !== undefined && thread.state === 'working'
  return (
    <div className={cn('group flex items-center rounded-sm transition-colors duration-150 hover:bg-raised', onScreen && 'bg-raised/60')}>
      <button type="button" onClick={() => onOpen(thread.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm px-3 py-2 text-left">
        <StateDot state={thread.state} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn('truncate', thread.kind !== 'topic' ? 'text-[0.8125rem] text-text-soft' : 'text-sm')}>{thread.title}</span>
          <span className="truncate text-label text-text-faint">
            {KIND[thread.kind]} · {STATE[thread.state]}
            {onScreen ? ' · on screen' : ''}
            {thread.folder && <span title={thread.folder}> · in {lastPart(thread.folder)}</span>}
          </span>
        </span>
        {!stoppable && (
          <span aria-hidden="true" className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100">
            ›
          </span>
        )}
      </button>
      {stoppable && (
        <button
          type="button"
          onClick={() => onStop(thread.id)}
          aria-label={`Stop ${thread.title}`}
          className="mr-2 h-6 shrink-0 rounded-sm px-2 text-label text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:bg-danger/15 hover:text-danger"
        >
          Stop
        </button>
      )}
    </div>
  )
}

/** Where a thread stands, as a dot: pulsing while it works, the accent when its answer waits. */
export function StateDot({ state }: { state: Thread['state'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        state === 'working' && 'animate-pulse bg-accent',
        state === 'ready' && 'bg-accent',
        state === 'parked' && 'bg-text-faint/60'
      )}
    />
  )
}
