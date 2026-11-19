import { type Event, onTop, type ShownView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant shows: the view on the stage, and the stream. */
export interface Shown {
  stage: ShownView | undefined
  /** Every view of the conversation still open, newest first, aside cards among them: what the main screen draws. */
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

/** How many arrived views are remembered: more than can be on screen at once. */
const ARRIVED = 12

export function followView(session: Session): ViewState {
  const state = cell<Shown>({ stage: undefined, stream: [], arrived: [] })
  type ViewEvent = Extract<Event, { name: 'view.shown' | 'view.cleared' }>
  /** What arrived while the first read was on its way, in order: applied again on top of what the read returns. */
  let early: ViewEvent[] | undefined = []

  const apply = (event: ViewEvent) => {
    const { stage, stream, arrived } = state.current()
    if (event.name === 'view.shown') {
      state.set({
        // An aside card goes on top of the stream, and the stage keeps the topic it was asked beside, as in the core.
        stage: event.view.aside === true ? stage : event.view,
        stream: onTop(stream, event.view),
        arrived: [...arrived.filter((id) => id !== event.view.id), event.view.id].slice(-ARRIVED)
      })
    } else {
      const id = event.view
      // Without a view named, the topic in focus has nothing to show: the stage empties, the stream stays as it is.
      state.set({
        stage: id === undefined || stage?.id === id ? undefined : stage,
        stream: id === undefined ? stream : stream.filter((view) => view.id !== id),
        arrived
      })
    }
  }

  const stopEvents = session.onEvent((event) => {
    if (event.name !== 'view.shown' && event.name !== 'view.cleared') return
    early?.push(event)
    apply(event)
  })
  session.run('view.read', {}).then(
    ({ view, stream }) => {
      // The read is the screen as the core had it when it read it, which may be before or after an event that arrived
      // meanwhile, such as a reminder ringing as the app opens. Those events are applied again on top of it: showing or
      // clearing a view twice changes nothing, so the stream read is kept whole and nothing newer is lost.
      const heard = early ?? []
      early = undefined
      state.set({ stage: view, stream, arrived: [] })
      for (const event of heard) apply(event)
    },
    () => {
      early = undefined
    }
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
