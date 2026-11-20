import type { Settings } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What a client knows of the user's settings. */
export type SettingsSnapshot =
  /** The core has not answered yet. */
  | { state: 'loading' }
  | { state: 'ready'; settings: Settings }
  /** They could not be read, and why, in words for a developer. */
  | { state: 'failed'; reason: string }

/** The user's settings, kept current for as long as the session lasts. */
export interface SettingsState extends Followed<SettingsSnapshot> {
  unfollow(): void
}

/**
 * Read the user's settings from the core and follow their changes, from this device or another.
 *
 * Two copies can cross on the way, one read and one announced. The later revision wins, whatever order they arrive in.
 */
export function followSettings(session: Session): SettingsState {
  const state = cell<SettingsSnapshot>({ state: 'loading' })
  let stopped = false

  const accept = (settings: Settings) => {
    const known = state.current()
    if (stopped || (known.state === 'ready' && known.settings.revision >= settings.revision)) return
    state.set({ state: 'ready', settings })
  }

  const stopEvents = session.onEvent((event) => {
    if (event.name === 'settings.changed') accept(event.settings)
  })
  session.run('settings.read', {}).then(
    ({ settings }) => accept(settings),
    (error: unknown) => {
      if (!stopped && state.current().state === 'loading') state.set({ state: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  )

  return {
    current: state.current,
    subscribe: state.subscribe,
    unfollow() {
      stopped = true
      stopEvents()
    }
  }
}
