export { type Client, openClient } from './client.ts'
export { type Connection, ConnectionRefused, connect, HandshakeFailed, type Identity } from './connection.ts'
export {
  type AudioDevice,
  changeDeviceSettings,
  DEFAULT_DEVICE_SETTINGS,
  type DeviceSettings,
  type DeviceSettingsChange,
  PAUSES,
  type Pause,
  pauseMs,
  readDeviceSettings,
  SHEET_WIDTH,
  SPEEDS,
  shortcutClash
} from './device/settings.ts'
export {
  describeShortcut,
  isShortcut,
  type KeyPress,
  matchesShortcut,
  type Recorded,
  recordShortcut,
  sameShortcut,
  shortcutKeys
} from './device/shortcuts.ts'
export type { UpdateState } from './device/updates.ts'
export { FACT_KIND_TITLES, memoryMarkdown } from './export/memory-markdown.ts'
export { CommandFailed, type CommandFailure, openSession, type Session, type SessionLink } from './session.ts'
export { type DeviceVoice, playSpeech, type Speaking, type SpeechPlayer } from './speech-player.ts'
export { type Activity, followActivity } from './state/activity.ts'
export { type ChannelSnapshot, type ChannelState, followChannel, type Sentence } from './state/channel.ts'
export type { CoreLink } from './state/core-link.ts'
export { type EnginesState, followEngines } from './state/engines.ts'
export { type Cell, cell, type Followed } from './state/followed.ts'
export { followEvents, type Logged } from './state/inspector.ts'
export { collectionsOf, dockedOf, followLibrary, type LibraryState, pinnedOf, savedAs } from './state/library.ts'
export { followMemory, type MemoryState } from './state/memory.ts'
export { followSettings, type SettingsSnapshot, type SettingsState } from './state/settings.ts'
export { followThreads, type ThreadRead, type ThreadsState } from './state/threads.ts'
export { followView, type Shown, type ViewState } from './state/view.ts'
export type { Transport } from './transport.ts'
