import type { ShownView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant shows: the stage, and the aside cards of the margin, newest last. */
export interface Shown {
  stage: ShownView | undefined
  margin: readonly ShownView[]
  /**
   * The views that arrived while this client was connected, as opposed to ones read when it connected: only
   * these may start playing by themselves, so the app never bursts into sound on opening.
   */
  arrived: readonly string[]
}

export interface ViewState extends Followed<Shown> {
  /** Clear the stage, or one card of the margin. */
  clear(view?: string): Promise<void>
  unfollow(): void
}

/** How many cards the margin shows; the core keeps the same number. */
const MARGIN = 3
/** How many arrived views are remembered: more than can be on screen at once. */
const ARRIVED = 12

export function followView(session: Session): ViewState {
  const state = cell<Shown>({ stage: undefined, margin: [], arrived: [] })
  let heard = false
  const stopEvents = session.onEvent((event) => {
    const { stage, margin, arrived } = state.current()
    if (event.name === 'view.shown') {
      heard = true
      const now = [...arrived.filter((id) => id !== event.view.id), event.view.id].slice(-ARRIVED)
      if (event.view.slot === 'margin')
        state.set({
          stage,
          // An aside keeps one card in the margin, its latest, as the core does.
          margin: [
            ...margin.filter((card) => card.id !== event.view.id && (event.view.thread === undefined || card.thread !== event.view.thread)),
            event.view
          ].slice(-MARGIN),
          arrived: now
        })
      else state.set({ stage: event.view, margin, arrived: now })
    } else if (event.name === 'view.cleared') {
      heard = true
      const id = event.view
      state.set({ stage: id === undefined || stage?.id === id ? undefined : stage, margin: margin.filter((card) => card.id !== id), arrived })
    }
  })
  session.run('view.read', {}).then(
    ({ view, margin }) => {
      // An event that arrived while the read was on its way is newer than what the read returns.
      if (!heard) state.set({ stage: view, margin, arrived: [] })
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
