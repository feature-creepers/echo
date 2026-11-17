import type { z } from 'zod'
import { conversationCommands } from './commands/conversation.ts'
import { settingsCommands } from './commands/settings.ts'
import { viewCommands } from './commands/views.ts'

/** A command: what it takes and what it gives back. */
export interface CommandDefinition {
  input: z.ZodType
  output: z.ZodType
}

/** Every command a client can send, assembled from the groups in `commands/`. */
export const COMMANDS = { ...settingsCommands, ...conversationCommands, ...viewCommands } satisfies Record<string, CommandDefinition>

export type CommandName = keyof typeof COMMANDS
/** What a client sends: defaults may be left out. */
export type CommandInput<Name extends CommandName> = z.input<(typeof COMMANDS)[Name]['input']>
/** What a handler receives: defaults filled in. */
export type CommandRequest<Name extends CommandName> = z.output<(typeof COMMANDS)[Name]['input']>
export type CommandOutput<Name extends CommandName> = z.infer<(typeof COMMANDS)[Name]['output']>

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name)
}
