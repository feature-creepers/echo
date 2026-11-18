import { z } from 'zod'
import { desktopStateSchema } from '../desktop.ts'

export const desktopCommands = {
  /** Whether the assistant can see and operate the other apps of the core's computer, and which have a window open now. */
  'desktop.read': {
    input: z.object({}),
    output: z.object({ desktop: desktopStateSchema })
  }
}
