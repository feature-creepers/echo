import { useSyncExternalStore } from 'react'
import type { Followed } from '../state/followed.ts'

/** A piece of client state as a component reads it: the component draws again each time it changes. */
export function useFollowed<Value>(state: Followed<Value>): Value {
  return useSyncExternalStore(state.subscribe, state.current)
}
