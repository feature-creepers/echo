import type { z } from 'zod'
import { accessCommands } from './commands/access.ts'
import { browserCommands } from './commands/browser.ts'
import { cameraCommands } from './commands/camera.ts'
import { conversationCommands } from './commands/conversation.ts'
import { desktopCommands } from './commands/desktop.ts'
import { fileCommands } from './commands/files.ts'
import { libraryCommands } from './commands/library.ts'
import { memoryCommands } from './commands/memory.ts'
import { scheduleCommands } from './commands/schedule.ts'
import { settingsCommands } from './commands/settings.ts'
import { threadCommands } from './commands/threads.ts'
import { viewCommands } from './commands/views.ts'

/** A command: what it takes and what it gives back. */
export interface CommandDefinition {
  input: z.ZodType
  output: z.ZodType
}

/** Every command a client can send, assembled from the groups in `commands/`. */
export const COMMANDS = {
  ...settingsCommands,
  ...conversationCommands,
  ...viewCommands,
  ...threadCommands,
  ...memoryCommands,
  ...libraryCommands,
  ...browserCommands,
  ...desktopCommands,
  ...scheduleCommands,
  ...fileCommands,
  ...accessCommands,
  ...cameraCommands
} satisfies Record<string, CommandDefinition>

export type CommandName = keyof typeof COMMANDS
/** What a client sends: defaults may be left out. */
export type CommandInput<Name extends CommandName> = z.input<(typeof COMMANDS)[Name]['input']>
/** What a handler receives: defaults filled in. */
export type CommandRequest<Name extends CommandName> = z.output<(typeof COMMANDS)[Name]['input']>
export type CommandOutput<Name extends CommandName> = z.infer<(typeof COMMANDS)[Name]['output']>

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name)
}
