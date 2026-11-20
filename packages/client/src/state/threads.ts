import type { CommandInput, CommandOutput, Step, Threads } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** A page of one thread, as the side sheet reads it. */
export type ThreadRead = CommandOutput<'thread.read'>

/** The threads behind the conversation, kept current for as long as the session lasts. */
export interface ThreadsState extends Followed<Threads> {
  /** Bring a topic back to the stage, or, when the last thing it showed is a side question's card, that card on top. */
  focus(thread: string): Promise<void>
  /** Stop one thread's work, or with none named, every thread's. */
  stop(thread?: string): Promise<void>
  /** Put a waiting answer away unseen: one topic's, or with none named, every one that waits. */
  dismiss(thread?: string): Promise<void>
  /**
   * A page of one thread: its latest requests, or those just before `before`, with their full answers, their tool
   * calls previewed and the titles of their views.
   */
  read(thread: string, before?: string): Promise<ThreadRead>
  /** One tool call of a thread whole: what it was given and what it gave back. */
  step(thread: string, call: string): Promise<Step>
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
    async dismiss(thread) {
      await session.run('threads.dismiss', thread === undefined ? {} : { thread })
    },
    read: (thread, before) => session.run('thread.read', before === undefined ? { thread } : { thread, before }),
    step: async (thread, call) => (await session.run('thread.step', { thread, call })).step,
    open: (project) => session.run('project.open', project),
    unfollow: stopEvents
  }
}
