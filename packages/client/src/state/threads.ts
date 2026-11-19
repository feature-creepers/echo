import type { CommandInput, CommandOutput, Threads } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** One thread whole, as the side sheet shows it. */
export type ThreadRead = CommandOutput<'thread.read'>

/** The threads behind the conversation, kept current for as long as the session lasts. */
export interface ThreadsState extends Followed<Threads> {
  /** Bring a thread back: a topic to the stage, an aside's card beside it. */
  focus(thread: string): Promise<void>
  /** Stop one thread's work, or with none named, every thread's. */
  stop(thread?: string): Promise<void>
  /** One thread whole: its exchanges with their full answers, its tool calls, its views. */
  read(thread: string): Promise<ThreadRead>
  /**
   * Open a project in a folder the person chose, with what to do there first: its thread answers at once, on the
   * stage. Rejects with why not, in words for the person.
   */
  open(project: CommandInput<'project.open'>): Promise<CommandOutput<'project.open'>>
  unfollow(): void
}

export function followThreads(session: Session): ThreadsState {
  const state = cell<Threads>({ threads: [] })
  let heard = false
  const stopEvents = session.onEvent((event) => {
    if (event.name !== 'threads.changed') return
    heard = true
    state.set(event.threads)
  })
  session.run('threads.read', {}).then(
    (threads) => {
      if (!heard) state.set(threads)
    },
    () => undefined
  )
  return {
    current: state.current,
    subscribe: state.subscribe,
    async focus(thread) {
      await session.run('thread.focus', { thread })
    },
    async stop(thread) {
      await session.run('threads.stop', thread === undefined ? {} : { thread })
    },
    read: (thread) => session.run('thread.read', { thread }),
    open: (project) => session.run('project.open', project),
    unfollow: stopEvents
  }
}
