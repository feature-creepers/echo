import type { ShownView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant is showing, kept current for as long as the session lasts. Nothing when the screen is clear. */
export interface ViewState extends Followed<ShownView | undefined> {
  /** Clear the screen. */
  clear(): Promise<void>
  unfollow(): void
}

export function followView(session: Session): ViewState {
  const state = cell<ShownView | undefined>(undefined)
  let heard = false
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'view.shown') {
      heard = true
      state.set(event.view)
    } else if (event.name === 'view.cleared') {
      heard = true
      state.set(undefined)
    }
  })
  session.run('view.read', {}).then(
    ({ view }) => {
      // An event that arrived while the read was on its way is newer than what the read returns.
      if (!heard) state.set(view)
    },
    () => undefined
  )
  return {
    current: state.current,
    subscribe: state.subscribe,
    async clear() {
      await session.run('view.clear', {})
    },
    unfollow: stopEvents
  }
}
