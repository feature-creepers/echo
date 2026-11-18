import { z } from 'zod'

/**
 * What a device can offer the core. The core owns no hardware: it reaches the microphone, the screen
 * or the user's files only through a client that declared the matching capability when it connected.
 */
export const CAPABILITIES = [
  /** It can draw views. */
  'display',
  /** It can capture the user's voice. */
  'microphone',
  /** It can play sound. */
  'speaker',
  /** It turns speech into text by itself, so it sends text rather than audio. */
  'recognition',
  /** It voices text by itself, so it receives text rather than audio. */
  'voice',
  /** The user's own files, within the scope they granted. */
  'files',
  /** A music player. */
  'media',
  /** Readings of the machine, its time zone and its place. */
  'system',
  /** The selection in other apps, and writing at the cursor. */
  'cursor',
  /** Seeing and operating other apps. */
  'screen',
  /** Notifications. */
  'notify'
] as const

export const capabilitySchema = z.enum(CAPABILITIES)
export type Capability = z.infer<typeof capabilitySchema>
