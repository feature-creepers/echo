import type { ShownView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant shows: the stage, and the aside cards of the margin, newest last. */
export interface Shown {
  stage: ShownView | undefined
  margin: readonly ShownView[]
}

export interface ViewState extends Followed<Shown> {
  /** Clear the stage, or one card of the margin. */
  clear(view?: string): Promise<void>
  unfollow(): void
}

/** How many cards the margin shows; the core keeps the same number. */
const MARGIN = 3

export function followView(session: Session): ViewState {
  const state = cell<Shown>({ stage: undefined, margin: [] })
  let heard = false
  const stopEvents = session.onEvent((event) => {
    const { stage, margin } = state.current()
    if (event.name === 'view.shown') {
      heard = true
      if (event.view.slot === 'margin') state.set({ stage, margin: [...margin.filter((card) => card.id !== event.view.id), event.view].slice(-MARGIN) })
      else state.set({ stage: event.view, margin })
    } else if (event.name === 'view.cleared') {
      heard = true
      const id = event.view
      state.set({ stage: id === undefined || stage?.id === id ? undefined : stage, margin: margin.filter((card) => card.id !== id) })
    }
  })
  session.run('view.read', {}).then(
    ({ view, margin }) => {
      // An event that arrived while the read was on its way is newer than what the read returns.
      if (!heard) state.set({ stage: view, margin })
    },
    () => undefined
  )
  return {
    current: state.current,
    subscribe: state.subscribe,
    async clear(view) {
      await session.run('view.clear', view === undefined ? {} : { view })
    },
    unfollow: stopEvents
  }
}
