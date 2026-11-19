import type { Event } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** One event as the inspector shows it: when it arrived, and the event whole. */
export interface Logged {
  /**
   * Its place in the order of arrival, unique while the app runs: what tells two events apart when they arrive in
   * the same millisecond with the same words, and how many arrived after one.
   */
  id: number
  at: number
  event: Event
}

/** How many events the inspector keeps. */
const KEPT = 400

/**
 * Every event the core sends, newest last, for the inspector: the most technical view of what happens
 * behind the conversation. It is kept on the device only, and only while the app runs.
 */
export function followEvents(session: Session): Followed<readonly Logged[]> & { unfollow(): void } {
  const state = cell<readonly Logged[]>([])
  let arrived = 0
  const stop = session.onEvent((event) => {
    arrived += 1
    state.set([...state.current().slice(-(KEPT - 1)), { id: arrived, at: Date.now(), event }])
  })
  return { current: state.current, subscribe: state.subscribe, unfollow: stop }
}
