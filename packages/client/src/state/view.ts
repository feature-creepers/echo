import { onTop, type ShownView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant shows: the stage, the aside cards of the margin, newest last, and the stream. */
export interface Shown {
  stage: ShownView | undefined
  margin: readonly ShownView[]
  /** Every view of the conversation still open, newest first, stage and asides together: what the main screen draws. */
  stream: readonly ShownView[]
  /**
   * The views that arrived while this client was connected, as opposed to ones read when it connected: only
   * these may start playing by themselves, so the app never bursts into sound on opening.
   */
  arrived: readonly string[]
}

export interface ViewState extends Followed<Shown> {
  /** Close a view of the stream, or, left out, the one on the stage. */
  clear(view?: string): Promise<void>
  unfollow(): void
}

/** How many cards the margin shows; the core keeps the same number. */
const MARGIN = 3
/** How many arrived views are remembered: more than can be on screen at once. */
const ARRIVED = 12

export function followView(session: Session): ViewState {
  const state = cell<Shown>({ stage: undefined, margin: [], stream: [], arrived: [] })
  let heard = false
  const stopEvents = session.onEvent((event) => {
    const { stage, margin, stream, arrived } = state.current()
    if (event.name === 'view.shown') {
      heard = true
      const now = [...arrived.filter((id) => id !== event.view.id), event.view.id].slice(-ARRIVED)
      const next = onTop(stream, event.view)
      if (event.view.slot === 'margin')
        state.set({
          stage,
          // An aside keeps one card in the margin, its latest, as the core does.
          margin: [
            ...margin.filter((card) => card.id !== event.view.id && (event.view.thread === undefined || card.thread !== event.view.thread)),
            event.view
          ].slice(-MARGIN),
          stream: next,
          arrived: now
        })
      else state.set({ stage: event.view, margin, stream: next, arrived: now })
    } else if (event.name === 'view.cleared') {
      heard = true
      const id = event.view
      // Without a view named, the topic in focus has nothing to show: the stage empties, the stream stays as it is.
      state.set({
        stage: id === undefined || stage?.id === id ? undefined : stage,
        margin: margin.filter((card) => card.id !== id),
        stream: id === undefined ? stream : stream.filter((view) => view.id !== id),
        arrived
      })
    }
  })
  session.run('view.read', {}).then(
    ({ view, margin, stream }) => {
      // An event that arrived while the read was on its way is newer than what the read returns.
      if (!heard) state.set({ stage: view, margin, stream, arrived: [] })
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
