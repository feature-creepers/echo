import { z } from 'zod'

/**
 * The agreement between a core and the program that starts it on the same machine.
 *
 * The starter gives the core a folder for the user's data, and the token a local client must present: on the port
 * between them when the core runs as an Electron utility process, else on the first line of the core's standard
 * input. Never in the environment, which the person's other programs can read for as long as the core runs. The core
 * picks where it listens, and says so with one line on its standard output once it accepts connections. Everything
 * else the core prints goes to its standard error.
 */

/**
 * The option that tells the core to stop when its standard input closes. A starter that keeps the core
 * as its child passes it, so the core never outlives the app. A core run as a service does not.
 */
export const EXIT_WITH_PARENT_OPTION = 'exit-with-parent'
export const EXIT_WITH_PARENT_FLAG = `--${EXIT_WITH_PARENT_OPTION}` as const

/**
 * The option that tells the core which folder to keep the user's data in. The core creates it when missing
 * and is the only program that writes there.
 */
export const DATA_OPTION = 'data'

/** The line a core prints on its standard output once it accepts connections. */
export const readySchema = z.object({
  type: z.literal('ready'),
  /** Where it listens: a Unix socket path, or a named pipe on Windows. */
  endpoint: z.string().min(1)
})
export type Ready = z.infer<typeof readySchema>

/** What a core says to its starter on the port between them. */
export const coreMessageSchema = z.discriminatedUnion('type', [
  /** It asks for its token, once it listens on the port, so the answer cannot come first. */
  z.object({ type: z.literal('token-wanted') })
])
export type CoreMessage = z.infer<typeof coreMessageSchema>

/** What a starter says to its core on the port between them. */
export const starterMessageSchema = z.discriminatedUnion('type', [
  /** The token a local client must present. The first one stands. */
  z.object({ type: z.literal('token'), token: z.string() })
])
export type StarterMessage = z.infer<typeof starterMessageSchema>

/** One handler for each type of message a side receives on the port. */
type PortHandlers<Message extends { type: string }> = {
  [Type in Message['type']]: (message: Extract<Message, { type: Type }>) => void
}

/**
 * Give each message received on the port to the handler for its type. Anything else is ignored: the vault's messages
 * have listeners of their own, and a starter or a core of another version may say what this one does not know.
 */
export function onPortMessage<Message extends { type: string }>(schema: z.ZodType<Message>, handlers: PortHandlers<Message>): (received: unknown) => void {
  return (received) => {
    const read = schema.safeParse(received)
    if (!read.success) return
    const handle = handlers[read.data.type as Message['type']] as (message: Message) => void
    handle(read.data)
  }
}

/**
 * The vault (docs/SPEC.md, section 12.4, item 4). Secrets are sealed by the program that started the core, with the
 * system's own store, and kept sealed by the core, outside the store. A core started as an Electron utility process
 * asks over its parent port; started any other way, it has nobody to ask and keeps secrets in memory only.
 */

/** The longest text the vault seals or opens, in characters: a token, never a file. */
export const VAULT_TEXT_MAX_LENGTH = 65_536

/**
 * What the core asks of its starter: `seal` a text and answer with the sealed bytes in base 64, `open` sealed bytes
 * given in base 64 and answer with the text, or say whether sealing `keeping` anything here at all.
 */
export const vaultRequestSchema = z.object({
  type: z.literal('vault'),
  id: z.string().min(1).max(64),
  op: z.enum(['seal', 'open', 'keeping']),
  text: z
    .string()
    .max(VAULT_TEXT_MAX_LENGTH * 2)
    .optional()
})
export type VaultRequest = z.infer<typeof vaultRequestSchema>

/**
 * The starter's answer to the request of the same `id`. Refused, or for `keeping` when nothing would be kept safely,
 * `ok` is false and `reason` says why, in words for the person. `stale`, on an opened text, means the system wants it
 * sealed again: the core seals it anew and keeps the new bytes.
 */
export const vaultAnswerSchema = z.object({
  type: z.literal('vault'),
  id: z.string().min(1).max(64),
  ok: z.boolean(),
  text: z
    .string()
    .max(VAULT_TEXT_MAX_LENGTH * 2)
    .optional(),
  stale: z.literal(true).optional(),
  reason: z.string().max(1000).optional()
})
export type VaultAnswer = z.infer<typeof vaultAnswerSchema>
