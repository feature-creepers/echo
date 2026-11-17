import type { Threads } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The threads behind the conversation, kept current for as long as the session lasts. */
export interface ThreadsState extends Followed<Threads> {
  /** Bring a topic back to the stage. */
  focus(thread: string): Promise<void>
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
    unfollow: stopEvents
  }
}
