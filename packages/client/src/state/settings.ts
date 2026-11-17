import type { Settings } from '@repo/protocol'
import type { Session } from '../session.ts'
import type { Followed } from './followed.ts'

/** What a client knows of the user's settings. */
export type SettingsSnapshot =
  /** The core has not answered yet. */
  | { state: 'loading' }
  | { state: 'ready'; settings: Settings }
  /** They could not be read, and why, in words for a developer. */
  | { state: 'failed'; reason: string }

/** The user's settings, kept current for as long as the session lasts. */
export interface SettingsState extends Followed<SettingsSnapshot> {
  stop(): void
}

/**
 * Read the user's settings from the core and follow their changes, from this device or another.
 *
 * Two copies can cross on the way, one read and one announced. The later revision wins, whatever order they arrive in.
 */
export function followSettings(session: Session): SettingsState {
  let snapshot: SettingsSnapshot = { state: 'loading' }
  const listeners = new Set<() => void>()
  let stopped = false

  const set = (next: SettingsSnapshot) => {
    if (stopped) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const accept = (settings: Settings) => {
    if (snapshot.state === 'ready' && snapshot.settings.revision >= settings.revision) return
    set({ state: 'ready', settings })
  }

  const stopEvents = session.onEvent((event) => {
    if (event.name === 'settings.changed') accept(event.settings)
  })
  session.run('settings.read', {}).then(
    ({ settings }) => accept(settings),
    (error: unknown) => {
      if (snapshot.state === 'loading') set({ state: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  )

  return {
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    stop() {
      stopped = true
      stopEvents()
      listeners.clear()
    }
  }
}
