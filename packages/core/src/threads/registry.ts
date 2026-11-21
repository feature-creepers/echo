import { type Event, type Thread, type Threads, threadSchema } from '@repo/protocol'
import type { Records } from '../ports/records.ts'
import { shorten } from '../text.ts'

/** The type of the record written each time a thread is opened or changes. Its payload is the thread whole. */
export const THREAD = 'thread'
/** The type of the record written when the focus moves to another topic. */
const FOCUS = 'thread.focus'

/** How many threads the orchestrator is told about. Older ones are still kept, and searched later. */
const INDEXED = 12

export interface ThreadRegistry {
  read(): Threads
  get(id: string): Thread | undefined
  /**
   * Open a thread. A sub-thread is given the thread that opened it; a topic opened for a side question, the topic on
   * the stage it was asked beside; a project's topic or sub-thread, the folder it works in.
   */
  open(asked: { title: string; kind: Thread['kind']; parent?: string | undefined; beside?: string | undefined; folder?: string | undefined }): Thread
  setState(id: string, state: Thread['state']): void
  /** Put a thread away in the side sheet, or bring it back. Work on it brings it back by itself. */
  archive(id: string, archived: boolean): void
  /** Bring a topic to the stage. A sub-thread never takes the focus: it works for its topic. */
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

/** How much of a thread's summary the orchestrator reads beside its line: enough to know where a request belongs. */
const ABOUT_LENGTH = 240

/** A thread's summary, as the orchestrator reads it on the thread's line. */
const about = (summary: string | undefined): string => {
  const text = shorten(summary ?? '', ABOUT_LENGTH)
  return text === '' ? '' : `\n  about: ${text}`
}

/**
 * A thread as it was recorded. Side questions were once a kind of thread of their own, `aside`, with the topic they
 * were asked beside as their `parent`: they are read as the topics they are, opened beside that one.
 */
const fromRecord = (payload: unknown): unknown => {
  if (typeof payload !== 'object' || payload === null || (payload as { kind?: unknown }).kind !== 'aside') return payload
  const { parent, ...rest } = payload as { parent?: unknown }
  return { ...rest, kind: 'topic', ...(parent === undefined ? {} : { beside: parent }) }
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
    open({ title, kind, parent, beside, folder }) {
      const thread: Thread = {
        id: newId(),
        title,
        kind,
        state: 'working',
        at: now().toISOString(),
        ...(kind === 'subthread' && parent !== undefined && threads.has(parent) ? { parent } : {}),
        // A project is a topic of its own, never a side question.
        ...(kind === 'topic' && folder === undefined && beside !== undefined && threads.get(beside)?.kind === 'topic' ? { beside } : {}),
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
    focus(id) {
      const thread = threads.get(id)
      if (thread?.kind !== 'topic' || focus === id) return
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
        .map((thread) => {
          const answering = thread.state === 'working' ? doing?.(thread.id) : undefined
          const facts = [
            thread.kind,
            thread.beside === undefined ? undefined : `a side question asked beside ${thread.beside}`,
            thread.state,
            thread.folder === undefined ? undefined : `working in ${thread.folder}`,
            thread.id === focus ? 'on screen' : undefined,
            thread.archived ? 'archived by the person' : undefined,
            answering ? `answering: ${answering}` : undefined,
            `last used ${thread.at.slice(0, 16).replace('T', ' ')}`
          ]
          return `- ${thread.id}: "${thread.title}" (${facts.filter(Boolean).join(', ')})${about(summary?.(thread.id))}`
        })
        .join('\n')
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
