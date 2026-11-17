import { type Event, type Thread, type Threads, threadSchema } from '@repo/protocol'
import type { Records } from '../ports/records.ts'

/** The type of the record written each time a thread is opened or changes. Its payload is the thread whole. */
export const THREAD = 'thread'
/** The type of the record written when the focus moves to another topic. */
export const FOCUS = 'thread.focus'

/** How many threads the orchestrator is told about. Older ones are still kept, and searched later. */
const INDEXED = 12

export interface ThreadRegistry {
  read(): Threads
  get(id: string): Thread | undefined
  open(title: string, kind: Thread['kind']): Thread
  setState(id: string, state: Thread['state']): void
  /** Bring a topic to the stage. An aside never takes the focus. */
  focus(id: string): void
  focused(): Thread | undefined
  /** The recent threads, as the orchestrator reads them: one line each. */
  index(): string
  onEvent(listener: (event: Event) => void): () => void
}

export interface RegistryOptions {
  records: Records
  now: () => Date
  newId: () => string
}

/** The threads, built from their records, and kept current as they open, work, finish and take the focus. */
export function createThreadRegistry({ records, now, newId }: RegistryOptions): ThreadRegistry {
  const threads = new Map<string, Thread>()
  let focus: string | undefined
  for (const record of records.read([THREAD, FOCUS])) {
    if (record.type === FOCUS) {
      const id = (record.payload as { thread?: unknown }).thread
      if (typeof id === 'string') focus = id
      continue
    }
    const thread = threadSchema.safeParse(record.payload)
    // A thread left working when the core stopped is idle now: its session is gone.
    if (thread.success) threads.set(thread.data.id, thread.data.state === 'working' ? { ...thread.data, state: 'parked' } : thread.data)
  }

  const listeners = new Set<(event: Event) => void>()
  const read = (): Threads => {
    const list = [...threads.values()].sort((one, other) => other.at.localeCompare(one.at))
    return focus !== undefined && threads.has(focus) ? { threads: list, focus } : { threads: list }
  }
  const announce = () => {
    const event: Event = { type: 'event', name: 'threads.changed', threads: read() }
    for (const listener of listeners) listener(event)
  }
  const write = (thread: Thread) => {
    threads.set(thread.id, thread)
    records.append([{ type: THREAD, payload: thread }])
    announce()
  }

  return {
    read,
    get: (id) => threads.get(id),
    open(title, kind) {
      const thread: Thread = { id: newId(), title, kind, state: 'working', at: now().toISOString() }
      write(thread)
      return thread
    },
    setState(id, state) {
      const thread = threads.get(id)
      if (!thread || thread.state === state) return
      write({ ...thread, state, at: now().toISOString() })
    },
    focus(id) {
      const thread = threads.get(id)
      if (!thread || thread.kind === 'aside' || focus === id) return
      focus = id
      records.append([{ type: FOCUS, payload: { thread: id } }])
      announce()
    },
    focused: () => (focus === undefined ? undefined : threads.get(focus)),
    index() {
      const recent = read().threads.slice(0, INDEXED)
      if (recent.length === 0) return 'There are no threads yet.'
      return recent
        .map(
          (thread) =>
            `- ${thread.id}: "${thread.title}" (${thread.kind}, ${thread.state}${thread.id === focus ? ', on screen' : ''}, last used ${thread.at.slice(0, 16).replace('T', ' ')})`
        )
        .join('\n')
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
