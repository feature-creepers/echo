import type { Thread, Threads } from '@repo/protocol'
import { lastPart } from '../changes/words.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'

const STATE = { working: 'working', ready: 'ready', parked: 'idle' } as const

/** A topic, and the asides asked beside it, the most recent first. */
export interface TopicGroup {
  topic: Thread
  asides: Thread[]
}

/**
 * The threads as the side sheet lists them: each topic with the asides asked while it was on the stage under
 * it. Asides from before they knew their topic, or whose topic is gone, are listed apart.
 */
export function groupThreads(threads: readonly Thread[]): { groups: TopicGroup[]; loose: Thread[] } {
  const topics = threads.filter((thread) => thread.kind === 'topic')
  const ids = new Set(topics.map((topic) => topic.id))
  const groups = topics.map((topic) => ({ topic, asides: threads.filter((thread) => thread.kind === 'aside' && thread.parent === topic.id) }))
  const loose = threads.filter((thread) => thread.kind === 'aside' && (thread.parent === undefined || !ids.has(thread.parent)))
  return { groups, loose }
}

/** The topics working behind the one conversation, with their asides. Pressing one opens it whole. */
export function ThreadList({ threads, onOpen }: { threads: Threads; onOpen(thread: string): void }) {
  if (threads.threads.length === 0) {
    return <p className="px-5 py-4 text-sm text-text-faint">Topics appear here as the conversation opens them.</p>
  }
  const { groups, loose } = groupThreads(threads.threads)
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul className="grid gap-px">
        {groups.map(({ topic, asides }) => (
          <li key={topic.id}>
            <Row thread={topic} onScreen={threads.focus === topic.id} onOpen={onOpen} />
            {asides.length > 0 && (
              <ul className="mb-1 ml-[1.375rem] grid gap-px border-line border-l pl-1.5">
                {asides.map((aside) => (
                  <li key={aside.id}>
                    <Row thread={aside} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {loose.length > 0 && (
        <div className="mt-3 grid gap-1">
          <Eyebrow className="px-3">Asides</Eyebrow>
          <ul className="grid gap-px">
            {loose.map((aside) => (
              <li key={aside.id}>
                <Row thread={aside} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Row({ thread, onScreen = false, onOpen }: { thread: Thread; onScreen?: boolean; onOpen(thread: string): void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-150 hover:bg-raised',
        onScreen && 'bg-raised/60'
      )}
    >
      <StateDot state={thread.state} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn('truncate', thread.kind === 'aside' ? 'text-[0.8125rem] text-text-soft' : 'text-sm')}>{thread.title}</span>
        <span className="truncate text-label text-text-faint">
          {thread.kind === 'aside' ? 'Aside' : 'Topic'} · {STATE[thread.state]}
          {onScreen ? ' · on screen' : ''}
          {thread.folder && <span title={thread.folder}> · in {lastPart(thread.folder)}</span>}
        </span>
      </span>
      <span aria-hidden="true" className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100">
        ›
      </span>
    </button>
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
