import type { z } from 'zod'
import { settingsCommands } from './commands/settings.ts'

/** A command: what it takes and what it gives back. */
export interface CommandDefinition {
  input: z.ZodType
  output: z.ZodType
}

/** Every command a client can send, assembled from the groups in `commands/`. */
export const COMMANDS = { ...settingsCommands } satisfies Record<string, CommandDefinition>

export type CommandName = keyof typeof COMMANDS
export type CommandInput<Name extends CommandName> = z.infer<(typeof COMMANDS)[Name]['input']>
export type CommandOutput<Name extends CommandName> = z.infer<(typeof COMMANDS)[Name]['output']>

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name)
}
