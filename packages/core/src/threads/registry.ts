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
  /**
   * Open a thread. An aside is given the topic it sits beside; a sub-thread, the thread that opened it; a project's
   * topic or sub-thread, the folder it works in.
   */
  open(asked: { title: string; kind: Thread['kind']; parent?: string | undefined; folder?: string | undefined }): Thread
  setState(id: string, state: Thread['state']): void
  /** Bring a topic to the stage. An aside never takes the focus. */
  focus(id: string): void
  focused(): Thread | undefined
  /** The recent threads, as the orchestrator reads them: one line each, with what each at work is answering when `doing` says. */
  index(doing?: (thread: string) => string | undefined, summary?: (thread: string) => string | undefined): string
  onEvent(listener: (event: Event) => void): () => void
}

export interface RegistryOptions {
  records: Records
  now: () => Date
  newId: () => string
}

/** The threads, built from their records, and kept current as they open, work, finish and take the focus. */
/** How much of a thread's summary the orchestrator reads beside its line: enough to know where a request belongs. */
const ABOUT_LENGTH = 240

/** A thread's summary, as the orchestrator reads it on the thread's line. */
const about = (summary: string | undefined): string => {
  const text = summary?.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return `
  about: ${text.length > ABOUT_LENGTH ? `${text.slice(0, ABOUT_LENGTH - 1)}…` : text}`
}

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
    open({ title, kind, parent, folder }) {
      const thread: Thread = {
        id: newId(),
        title,
        kind,
        state: 'working',
        at: now().toISOString(),
        ...(kind !== 'topic' && parent !== undefined && threads.has(parent) ? { parent } : {}),
        ...(kind !== 'aside' && folder !== undefined ? { folder } : {})
      }
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
      if (!thread || thread.kind !== 'topic' || focus === id) return
      focus = id
      records.append([{ type: FOCUS, payload: { thread: id } }])
      announce()
    },
    focused: () => (focus === undefined ? undefined : threads.get(focus)),
    index(doing, summary) {
      // A sub-thread answers the thread that opened it, never the person: nothing is passed to it from the conversation.
      const recent = read()
        .threads.filter((thread) => thread.kind !== 'subthread')
        .slice(0, INDEXED)
      if (recent.length === 0) return 'There are no threads yet.'
      return recent
        .map(
          (thread) =>
            `- ${thread.id}: "${thread.title}" (${thread.kind}, ${thread.state}${thread.folder === undefined ? '' : `, working in ${thread.folder}`}${thread.id === focus ? ', on screen' : ''}${thread.state === 'working' && doing?.(thread.id) ? `, answering: ${doing(thread.id)}` : ''}, last used ${thread.at.slice(0, 16).replace('T', ' ')})${about(summary?.(thread.id))}`
        )
        .join('\n')
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
