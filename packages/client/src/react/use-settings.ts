import { useSyncExternalStore } from 'react'
import type { SettingsSnapshot, SettingsState } from '../state/settings.ts'

/** The user's settings as a component reads them: it draws again each time they change. */
export function useSettings(state: SettingsState): SettingsSnapshot {
  return useSyncExternalStore(state.subscribe, state.current)
}
