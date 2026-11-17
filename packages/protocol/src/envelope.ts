import { z } from 'zod'

/**
 * The three kinds of message exchanged once a client is admitted.
 *
 *   command   client to core: do this, or tell me this. Carries an identifier the client chose.
 *   result    core to client: the answer to one command, carrying the same identifier.
 *   event     core to every client: something changed.
 *
 * Which commands and events exist is in `commands.ts` and `events.ts`.
 */

const identifierSchema = z.string().min(1).max(64)

export const commandSchema = z.object({
  type: z.literal('command'),
  /** Chosen by the client, unique among its commands still waiting for a result. */
  id: identifierSchema,
  name: z.string().min(1).max(64),
  /** Checked against the command's definition by the core. A command sent without one is answered, not dropped. */
  input: z.unknown().optional()
})
export type Command = z.infer<typeof commandSchema>

export const COMMAND_ERRORS = [
  /** No command has that name on this core. */
  'unknown-command',
  /** The input is not what the command takes. */
  'invalid-input',
  /** The command names a persona that does not exist. */
  'unknown-persona',
  /** A name cannot be given to a persona. */
  'invalid-name',
  /** Two personas would be called the same. */
  'name-taken',
  /** The command names a harness that does not exist. */
  'unknown-harness',
  /** The command names a model the harness does not offer. */
  'unknown-model',
  /** The command names a fact the assistant does not know, or no longer knows. */
  'unknown-fact',
  /** The user chose that the assistant never sleeps. */
  'sleep-off',
  /** The core could not carry the command out, for a reason that is not the client's doing. */
  'failed'
] as const
export const commandErrorSchema = z.object({
  code: z.enum(COMMAND_ERRORS),
  /** For logs and developers. What the user reads is written by the client, from the code. */
  message: z.string()
})
export type CommandError = z.infer<typeof commandErrorSchema>
export type CommandErrorCode = CommandError['code']

export const resultSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('result'),
    id: identifierSchema,
    ok: z.literal(true),
    /** Checked against the command's definition by the client. */
    output: z.unknown()
  }),
  z.object({ type: z.literal('result'), id: identifierSchema, ok: z.literal(false), error: commandErrorSchema })
])
export type Result = z.infer<typeof resultSchema>

/** What every event carries. A client ignores an event whose name it does not know: a newer core may send more. */
export const eventPrefixSchema = z.object({
  type: z.literal('event'),
  name: z.string().min(1).max(64)
})
