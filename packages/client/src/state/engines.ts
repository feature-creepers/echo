import type { Engines } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The harnesses on the core's machine, kept current for as long as the session lasts. Nothing until the core has answered. */
export interface EnginesState extends Followed<Engines | undefined> {
  /** Ask the core to look again: after an install, after signing in. */
  refresh(): Promise<void>
  /** Open a harness's own sign-in on the core's machine. */
  signIn(harness: string): Promise<void>
  unfollow(): void
}

export function followEngines(session: Session): EnginesState {
  const state = cell<Engines | undefined>(undefined)
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'engines.changed') state.set(event.engines)
  })
  const refresh = async () => {
    const { engines } = await session.run('engines.read', {})
    state.set(engines)
  }
  refresh().catch(() => undefined)

  return {
    current: state.current,
    subscribe: state.subscribe,
    refresh,
    async signIn(harness) {
      await session.run('engines.sign-in', { harness })
    },
    unfollow: stopEvents
  }
}
