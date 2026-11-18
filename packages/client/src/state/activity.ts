import type { Step, TurnId } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant is doing for the turn under way, while the user waits. */
export interface Activity {
  turn: TurnId | undefined
  /** The calls under way, oldest first. The last one is what it is doing now. */
  running: readonly Step[]
}

/**
 * The tool calls under way, so the interface can say what the assistant is doing ("searching the web") instead
 * of only that it thinks. Calls end, or are forgotten when their turn ends.
 */
export function followActivity(session: Session): Followed<Activity> & { unfollow(): void } {
  const state = cell<Activity>({ turn: undefined, running: [] })
  const stop = session.onEvent((event) => {
    if (event.name === 'activity') {
      const step = event.step ?? { call: `${event.turn}:${event.tool}`, turn: event.turn, tool: event.tool, at: '' }
      const { turn, running } = state.current()
      const others = (turn === event.turn ? running : []).filter((one) => one.call !== step.call)
      state.set({ turn: event.turn, running: event.phase === 'started' ? [...others, step] : others })
    } else if (event.name === 'turn.ended' && state.current().turn === event.exchange.turn) {
      state.set({ turn: undefined, running: [] })
    }
  })
  return { current: state.current, subscribe: state.subscribe, unfollow: stop }
}
