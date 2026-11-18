import type { Event } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** One event as the inspector shows it: when it arrived, and the event whole. */
export interface Logged {
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
  const stop = session.onEvent((event) => state.set([...state.current().slice(-(KEPT - 1)), { at: Date.now(), event }]))
  return { current: state.current, subscribe: state.subscribe, unfollow: stop }
}
