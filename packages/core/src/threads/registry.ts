import { type Event, type Thread, type Threads, threadSchema } from '@repo/protocol'
import type { Records } from '../ports/records.ts'

/** The type of the record written each time a thread is opened or changes. Its payload is the thread whole. */
export const THREAD = 'thread'
/** The type of the record written when the focus moves to another thread. */
const FOCUS = 'thread.focus'

export interface ThreadRegistry {
  read(): Threads
  get(id: string): Thread | undefined
  /**
   * Open a thread. A sub-thread is given the thread that opened it; one that answers the person, the topic its
   * answers are filed in; a project's, the folder it works in.
   */
  open(asked: { title: string; kind: Thread['kind']; parent?: string | undefined; topic?: string | undefined; folder?: string | undefined }): Thread
  setState(id: string, state: Thread['state']): void
  /** Put a thread away in the side sheet, or bring it back. Work on it brings it back by itself. */
  archive(id: string, archived: boolean): void
  /** File what a thread answers in another topic. */
  file(id: string, topic: string): void
  /** The person turned to a thread. A sub-thread never takes the focus: it works for its thread. */
  focus(id: string): void
  focused(): Thread | undefined
  onEvent(listener: (event: Event) => void): () => void
}

export interface RegistryOptions {
  records: Records
  now: () => Date
  newId: () => string
}

/**
 * A thread as it was recorded. Side questions were once a kind of thread of their own, `aside`, with the topic they
 * were asked beside as their `parent`: they are read as the threads they are, which answer the person.
 */
const fromRecord = (payload: unknown): unknown => {
  if (typeof payload !== 'object' || payload === null || (payload as { kind?: unknown }).kind !== 'aside') return payload
  const { parent: _parent, ...rest } = payload as { parent?: unknown }
  return { ...rest, kind: 'topic' }
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
    const thread = threadSchema.safeParse(fromRecord(record.payload))
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
    open({ title, kind, parent, topic, folder }) {
      const thread: Thread = {
        id: newId(),
        title,
        kind,
        state: 'working',
        at: now().toISOString(),
        ...(kind === 'subthread' && parent !== undefined && threads.has(parent) ? { parent } : {}),
        ...(kind === 'topic' && topic !== undefined ? { topic } : {}),
        ...(folder !== undefined ? { folder } : {})
      }
      write(thread)
      return thread
    },
    setState(id, state) {
      const thread = threads.get(id)
      if (!thread || thread.state === state) return
      // A thread put away comes back once it works again.
      const { archived: _archived, ...rest } = thread
      write({ ...(state === 'working' ? rest : thread), state, at: now().toISOString() })
    },
    archive(id, archived) {
      const thread = threads.get(id)
      if (!thread || (thread.archived === true) === archived) return
      const { archived: _archived, ...rest } = thread
      write(archived ? { ...rest, archived: true } : rest)
    },
    file(id, topic) {
      const thread = threads.get(id)
      if (thread?.kind === 'topic' && thread.topic !== topic) write({ ...thread, topic })
    },
    focus(id) {
      const thread = threads.get(id)
      if (thread?.kind !== 'topic' || focus === id) return
      focus = id
      records.append([{ type: FOCUS, payload: { thread: id } }])
      announce()
    },
    focused: () => (focus === undefined ? undefined : threads.get(focus)),
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
